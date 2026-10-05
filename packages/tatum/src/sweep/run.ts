import type { GatewayNetwork } from "../config";
import type { Signer } from "./keys";
import type { ChainSweeper, SweepQuote } from "./types";

/**
 * Sweep orchestration, chain- and DB-agnostic (everything injected) so it is
 * unit-testable with fakes. The on-chain balance — never the DB — decides
 * what is swept; DB rows are the audit trail. See
 * docs/superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md.
 */

export interface SweepCandidate {
  depositId: string;
  status: string;
  receivingAddress: string;
  addressIndex: number;
  tokenContract: string | null;
}

export interface OpenSweepRow {
  id: string;
  fromAddress: string;
  status: string;
  sweepTxHash: string | null;
}

export type SweepRowPatch = {
  status: "GAS_SENT" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  gasTopUpTxHash?: string;
  gasTopUpRaw?: bigint;
  sweepTxHash?: string;
  error?: string;
};

export interface SweepDb {
  listCandidates(input: { network: string; includeUnresolved: boolean }): Promise<SweepCandidate[]>;
  start(input: {
    depositId: string;
    network: string;
    fromAddress: string;
    toAddress: string;
    tokenContract: string;
    tokenDecimals: number;
    rawAmount: bigint;
  }): Promise<{ id: string }>;
  update(id: string, patch: SweepRowPatch): Promise<unknown>;
  listOpen(network: string): Promise<OpenSweepRow[]>;
}

export interface SweepContext {
  network: GatewayNetwork;
  tokenContract: string;
  tokenDecimals: number;
  treasury: string;
  sweeper: ChainSweeper;
  deriveSigner(index: number): Signer;
  gasSigner: Signer;
  db: SweepDb;
  log(line: string): void;
  /** How long to wait for each broadcast tx to land. */
  txTimeoutMs?: number;
}

export interface SweepOptions {
  /** Addresses holding less than this (token base units) are skipped. */
  minTokenRaw: bigint;
  includeUnresolved: boolean;
  /** Max addresses to sweep this run. */
  limit?: number;
}

export type PlanItem =
  | { kind: "skip"; candidate: SweepCandidate; reason: "empty" | "below_min"; tokenBalance: bigint }
  | {
      kind: "sweep";
      candidate: SweepCandidate;
      signer: Signer;
      tokenBalance: bigint;
      nativeBalance: bigint;
      quote: SweepQuote;
      /** Native units the gas wallet sends first (0 = the address already holds enough). */
      topUp: bigint;
    };

export class AddressMismatchError extends Error {
  constructor(c: SweepCandidate, derived: string) {
    super(
      `Deposit ${c.depositId}: index ${c.addressIndex} derives ${derived}, but the deposit's address is ${c.receivingAddress}. ` +
        `Wrong wallet file or a corrupted row — aborting before anything is sent.`,
    );
    this.name = "AddressMismatchError";
  }
}

export class InsufficientGasError extends Error {
  constructor(have: bigint, need: bigint, symbol: string) {
    super(`Gas wallet holds ${have} but this run needs ${need} (base units of ${symbol}). Nothing was sent.`);
    this.name = "InsufficientGasError";
  }
}

const sameAddress = (network: GatewayNetwork, a: string, b: string) => (network === "tron" ? a === b : a.toLowerCase() === b.toLowerCase());

/**
 * Settles rows an earlier run left open. A broadcast sweep tx is checked on
 * chain; a row that never got that far is marked FAILED — the next plan
 * re-reads the live balance, so nothing is double-sent either way.
 */
export async function reconcileOpenSweeps(ctx: SweepContext): Promise<void> {
  for (const row of await ctx.db.listOpen(ctx.network)) {
    if (!row.sweepTxHash) {
      await ctx.db.update(row.id, { status: "FAILED", error: `interrupted before the sweep tx was broadcast (was ${row.status})` });
      ctx.log(`reconcile ${row.fromAddress}: FAILED (interrupted before broadcast)`);
      continue;
    }
    const outcome = await ctx.sweeper.waitForTx(row.sweepTxHash, 0);
    if (outcome === "success") await ctx.db.update(row.id, { status: "CONFIRMED" });
    else if (outcome === "failed") await ctx.db.update(row.id, { status: "FAILED", error: "sweep tx failed on-chain" });
    ctx.log(`reconcile ${row.fromAddress}: ${outcome === "pending" ? "still pending (left SUBMITTED)" : outcome}`);
  }
}

export async function planSweep(ctx: SweepContext, opts: SweepOptions): Promise<PlanItem[]> {
  const candidates = await ctx.db.listCandidates({ network: ctx.network, includeUnresolved: opts.includeUnresolved });
  // Every address is checked against the key BEFORE any chain call, so a
  // wrong wallet file fails fast and the plan never mixes key sources.
  const signers = candidates.map((c) => {
    const signer = ctx.deriveSigner(c.addressIndex);
    if (!sameAddress(ctx.network, signer.address, c.receivingAddress)) throw new AddressMismatchError(c, signer.address);
    return signer;
  });

  const plan: PlanItem[] = [];
  let sweeps = 0;
  for (const [i, candidate] of candidates.entries()) {
    if (opts.limit !== undefined && sweeps >= opts.limit) break;
    if (candidate.tokenContract && !sameAddress(ctx.network, candidate.tokenContract, ctx.tokenContract)) {
      ctx.log(`warning: deposit ${candidate.depositId} was issued for token ${candidate.tokenContract}; checking the configured ${ctx.tokenContract}`);
    }
    const tokenBalance = await ctx.sweeper.tokenBalance(candidate.receivingAddress);
    if (tokenBalance === 0n) {
      plan.push({ kind: "skip", candidate, reason: "empty", tokenBalance });
      continue;
    }
    if (tokenBalance < opts.minTokenRaw) {
      plan.push({ kind: "skip", candidate, reason: "below_min", tokenBalance });
      continue;
    }
    const quote = await ctx.sweeper.quoteSweep(candidate.receivingAddress, ctx.treasury, tokenBalance);
    const nativeBalance = await ctx.sweeper.nativeBalance(candidate.receivingAddress);
    const topUp = quote.requiredNative > nativeBalance ? quote.requiredNative - nativeBalance : 0n;
    plan.push({ kind: "sweep", candidate, signer: signers[i]!, tokenBalance, nativeBalance, quote, topUp });
    sweeps++;
  }
  return plan;
}

/** Native units the gas wallet must hold to fund every top-up in `plan`. */
export function gasNeeded(plan: PlanItem[]): bigint {
  return plan.reduce((sum, p) => (p.kind === "sweep" && p.topUp > 0n ? sum + p.topUp + p.quote.topUpOverhead : sum), 0n);
}

export interface SweepResult {
  confirmed: number;
  failed: number;
  pending: number;
}

export async function executeSweep(ctx: SweepContext, plan: PlanItem[]): Promise<SweepResult> {
  const result: SweepResult = { confirmed: 0, failed: 0, pending: 0 };
  const items = plan.filter((p): p is Extract<PlanItem, { kind: "sweep" }> => p.kind === "sweep");
  if (items.length === 0) return result;

  const need = gasNeeded(plan);
  if (need > 0n) {
    const have = await ctx.sweeper.nativeBalance(ctx.gasSigner.address);
    if (have < need) throw new InsufficientGasError(have, need, ctx.sweeper.nativeSymbol);
  }

  const timeout = ctx.txTimeoutMs ?? 120_000;
  for (const item of items) {
    const from = item.candidate.receivingAddress;
    const row = await ctx.db.start({
      depositId: item.candidate.depositId,
      network: ctx.network,
      fromAddress: from,
      toAddress: ctx.treasury,
      tokenContract: ctx.tokenContract,
      tokenDecimals: ctx.tokenDecimals,
      rawAmount: item.tokenBalance,
    });
    try {
      if (item.topUp > 0n) {
        const gasTx = await ctx.sweeper.sendNative(ctx.gasSigner, from, item.topUp);
        await ctx.db.update(row.id, { status: "GAS_SENT", gasTopUpTxHash: gasTx, gasTopUpRaw: item.topUp });
        ctx.log(`${from}: gas top-up ${item.topUp} sent (${gasTx})`);
        const gasOutcome = await ctx.sweeper.waitForTx(gasTx, timeout);
        if (gasOutcome !== "success") throw new Error(`gas top-up ${gasOutcome === "failed" ? "failed on-chain" : "not confirmed in time"} (${gasTx})`);
        // The node that confirmed the tx may serve balances a beat behind.
        let native = 0n;
        for (let attempt = 0; attempt < 5; attempt++) {
          native = await ctx.sweeper.nativeBalance(from);
          if (native >= item.quote.requiredNative) break;
          await new Promise((r) => setTimeout(r, Math.min(3_000, timeout)));
        }
        if (native < item.quote.requiredNative) throw new Error(`address holds ${native} after top-up, needs ${item.quote.requiredNative}`);
      }

      const sweepTx = await ctx.sweeper.sendToken(item.signer, ctx.treasury, item.tokenBalance, item.quote);
      await ctx.db.update(row.id, { status: "SUBMITTED", sweepTxHash: sweepTx });
      ctx.log(`${from}: sweep of ${item.tokenBalance} sent (${sweepTx})`);
      const outcome = await ctx.sweeper.waitForTx(sweepTx, timeout);
      if (outcome === "success") {
        await ctx.db.update(row.id, { status: "CONFIRMED" });
        result.confirmed++;
        ctx.log(`${from}: CONFIRMED`);
      } else if (outcome === "failed") {
        await ctx.db.update(row.id, { status: "FAILED", error: `sweep tx failed on-chain (${sweepTx})` });
        result.failed++;
        ctx.log(`${from}: FAILED on-chain`);
      } else {
        result.pending++;
        ctx.log(`${from}: not confirmed yet — left SUBMITTED; the next run reconciles it`);
      }
    } catch (err) {
      const message = (err as Error).message;
      await ctx.db.update(row.id, { status: "FAILED", error: message.slice(0, 1000) });
      result.failed++;
      ctx.log(`${from}: FAILED — ${message}`);
    }
  }
  return result;
}
