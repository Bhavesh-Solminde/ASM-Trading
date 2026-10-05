import {
  createChainCreditIfNew,
  findGatewayDepositByAddress,
  listDetectedGatewayCredits,
  listFinalUnmatchedGatewayCredits,
  markChainCreditsFailedForTx,
  markChainCreditsFinalForTx,
  matchGatewayChainCredit,
  prisma,
  setGatewaySubscriptionId,
  type Deposit,
  type GatewayMatchOutcome,
} from "@asm/db";
import type { GatewayChain } from "./chain";
import type { TatumNetworkConfig } from "./config";
import { deleteSubscription } from "./subscriptions";

/** Minimal logger surface (pino-compatible) so callers can pass their own child logger. */
export interface ProcessorLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}
const silent: ProcessorLog = { info() {}, warn() {} };

/** How far before a deposit's creation discovery looks (clock skew between us and the chain). */
const DISCOVERY_SLACK_MS = 2 * 60_000;

export type SettledOutcome = Exclude<GatewayMatchOutcome, { kind: "skipped" }>;

/**
 * The single path from "a tx touched a gateway address" to a credit, shared
 * by the webhook and the poller. Idempotent: ChainCredit identity is
 * (network, contract, txHash, eventIndex), and matching only ever acts on a
 * FINAL + PENDING row, so retries/duplicate notifications change nothing.
 *
 * Everything is re-derived from the chain via `chain.verifyTransfer` — the
 * caller's hint (webhook body, history row) only says WHICH tx to look at.
 */
export async function recordAndSettleTransfer(
  chain: GatewayChain,
  input: { txHash: string; toAddress: string },
  log: ProcessorLog = silent,
): Promise<{ recorded: number; settled: SettledOutcome[] }> {
  const key = { network: chain.network, tokenContract: chain.tokenContract, txHash: normalizeTxHash(chain, input.txHash) };
  const verified = await chain.verifyTransfer(key.txHash, input.toAddress);

  if (verified.kind === "not_found") return { recorded: 0, settled: [] };
  if (verified.kind === "failed") {
    const n = await markChainCreditsFailedForTx(key);
    if (n > 0) log.warn({ evt: "tatum.tx_failed", ...key, rows: n }, "previously detected transfer reverted on-chain");
    return { recorded: 0, settled: [] };
  }

  let recorded = 0;
  for (const t of verified.transfers) {
    const row = await createChainCreditIfNew({
      ...key,
      eventIndex: t.eventIndex,
      fromAddress: t.fromAddress,
      toAddress: input.toAddress,
      rawAmount: t.rawValue,
      tokenDecimals: chain.tokenDecimals,
      blockNumber: verified.blockNumber,
      blockTimestamp: new Date(verified.blockTimestampMs),
      rawPayload: {
        source: "tatum",
        eventIndex: t.eventIndex,
        rawValue: t.rawValue.toString(),
        blockNumber: verified.blockNumber.toString(),
        blockTimestampMs: verified.blockTimestampMs,
      },
    });
    if (row) {
      recorded++;
      log.info(
        { evt: "tatum.transfer_detected", ...key, eventIndex: t.eventIndex, toAddress: input.toAddress, raw: t.rawValue.toString() },
        "gateway transfer recorded",
      );
    }
  }

  if (!verified.final) {
    await touchTx(key);
    return { recorded, settled: [] };
  }

  await markChainCreditsFinalForTx(key);
  const rows = await prisma.chainCredit.findMany({
    where: { ...key, finalityState: "FINAL", processingStatus: "PENDING" },
    orderBy: { eventIndex: "asc" },
  });
  const settled: SettledOutcome[] = [];
  for (const row of rows) {
    const outcome = await matchGatewayChainCredit(row.id);
    if (outcome.kind === "skipped") continue;
    settled.push(outcome);
    log.info({ evt: "tatum.transfer_settled", ...key, chainCreditId: row.id, outcome }, "gateway transfer settled");
  }
  return { recorded, settled };
}

/**
 * Poller discovery for one deposit address. A tx already on record is left to
 * recheckDetectedCredits rather than re-verified here, so each tick costs one
 * history call per watched address, not one per historical tx.
 */
export async function scanGatewayDeposit(chain: GatewayChain, deposit: Deposit, log: ProcessorLog = silent): Promise<void> {
  if (!deposit.receivingAddress || deposit.network !== chain.network) return;
  const hashes = await chain.listIncomingTxHashes(deposit.receivingAddress, deposit.createdAt.getTime() - DISCOVERY_SLACK_MS);
  for (const raw of hashes) {
    const txHash = normalizeTxHash(chain, raw);
    const known = await prisma.chainCredit.count({
      where: { network: chain.network, tokenContract: chain.tokenContract, txHash },
    });
    if (known > 0) continue;
    await recordAndSettleTransfer(chain, { txHash, toAddress: deposit.receivingAddress }, log);
  }
}

/**
 * Advances every not-yet-final gateway credit (and settles any FINAL row a
 * crash left unmatched). Networks without an adapter in `chains` are skipped.
 */
export async function recheckDetectedCredits(
  chains: Map<string, GatewayChain>,
  log: ProcessorLog = silent,
  limit = 100,
): Promise<SettledOutcome[]> {
  const settled: SettledOutcome[] = [];
  const seen = new Set<string>();
  for (const credit of await listDetectedGatewayCredits(limit)) {
    const chain = chains.get(credit.network);
    if (!chain || credit.tokenContract !== chain.tokenContract) continue;
    const k = `${credit.network}:${credit.txHash}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const res = await recordAndSettleTransfer(chain, { txHash: credit.txHash, toAddress: credit.toAddress }, log);
    settled.push(...res.settled);
  }
  for (const credit of await listFinalUnmatchedGatewayCredits(limit)) {
    if (!chains.has(credit.network)) continue;
    const outcome = await matchGatewayChainCredit(credit.id);
    if (outcome.kind !== "skipped") settled.push(outcome);
  }
  return settled;
}

/**
 * Best-effort: deletes a closed deposit's Tatum alert (they bill per day).
 * Never throws — a leftover alert only costs credits; the next close/expiry
 * pass retries because the id is cleared only on success.
 */
export async function releaseDepositAlert(
  cfg: TatumNetworkConfig,
  depositId: string,
  log: ProcessorLog = silent,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit?.gatewaySubscriptionId) return;
  try {
    await deleteSubscription(cfg, deposit.gatewaySubscriptionId, fetchImpl);
    await setGatewaySubscriptionId(deposit.id, null);
  } catch (err) {
    log.warn({ evt: "tatum.alert_delete_failed", depositId, err: (err as Error).message }, "could not delete Tatum alert");
  }
}

/** Credits that changed a deposit's state, for callers that clean up alerts afterwards. */
export function closedDepositIds(outcomes: SettledOutcome[]): string[] {
  return outcomes.flatMap((o) => (o.kind === "credited" ? [o.depositId] : []));
}

export { findGatewayDepositByAddress };

// EVM hashes are case-insensitive (stored lowercase, 0x-prefixed); TRON tx ids are bare lowercase hex.
function normalizeTxHash(chain: GatewayChain, hash: string): string {
  const h = hash.trim().toLowerCase();
  return chain.network === "bsc" ? (h.startsWith("0x") ? h : `0x${h}`) : h.replace(/^0x/, "");
}

async function touchTx(key: { network: string; tokenContract: string; txHash: string }): Promise<void> {
  await prisma.chainCredit.updateMany({
    where: { ...key, finalityState: { in: ["DETECTED", "CONFIRMING"] } },
    data: { lastCheckedAt: new Date() },
  });
}
