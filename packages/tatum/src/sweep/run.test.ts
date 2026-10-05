import { describe, expect, it } from "vitest";
import type { Signer } from "./keys";
import {
  AddressMismatchError,
  InsufficientGasError,
  executeSweep,
  gasNeeded,
  planSweep,
  reconcileOpenSweeps,
  type SweepContext,
  type SweepDb,
} from "./run";
import type { ChainSweeper, SweepQuote, TxOutcome } from "./types";

const TREASURY = "0xtreasury";
const GAS: Signer = { address: "0xgas", privateKey: "gg" };
const QUOTE: SweepQuote = { requiredNative: 100n, topUpOverhead: 10n, gasLimit: 1n, gasPrice: 100n, note: "q" };

/** An in-memory chain: balances move when sends happen; outcomes are scriptable. */
function fakeChain(init: { token?: Record<string, bigint>; native?: Record<string, bigint>; outcomes?: TxOutcome[]; failSend?: string }) {
  const token = { ...init.token };
  const native = { ...init.native };
  const outcomes = [...(init.outcomes ?? [])];
  const sends: string[] = [];
  let n = 0;
  const sweeper: ChainSweeper = {
    network: "bsc",
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    tokenBalance: async (a) => token[a] ?? 0n,
    nativeBalance: async (a) => native[a] ?? 0n,
    quoteSweep: async () => QUOTE,
    sendNative: async (s, to, amount) => {
      if (init.failSend === "native") throw new Error("node down");
      sends.push(`native ${s.address}->${to} ${amount}`);
      native[to] = (native[to] ?? 0n) + amount;
      return `0xgas${++n}`;
    },
    sendToken: async (s, to, amount) => {
      if (init.failSend === "token") throw new Error("rejected");
      sends.push(`token ${s.address}->${to} ${amount}`);
      token[s.address] = 0n;
      return `0xsweep${++n}`;
    },
    waitForTx: async () => outcomes.shift() ?? "success",
  };
  return { sweeper, sends, token };
}

function fakeDb(candidates: { address: string; index: number; status?: string }[], open: { id: string; fromAddress: string; status: string; sweepTxHash: string | null }[] = []) {
  const rows: Record<string, Record<string, unknown>> = {};
  let n = 0;
  const db: SweepDb = {
    listCandidates: async () =>
      candidates.map((c) => ({ depositId: `dep-${c.index}`, status: c.status ?? "COMPLETED", receivingAddress: c.address, addressIndex: c.index, tokenContract: null })),
    start: async (input) => {
      const id = `row-${++n}`;
      rows[id] = { ...input, status: "PENDING" };
      return { id };
    },
    update: async (id, patch) => {
      rows[id] = { ...rows[id], ...patch };
    },
    listOpen: async () => open,
  };
  return { db, rows };
}

function ctx(chain: ChainSweeper, db: SweepDb, derive: (i: number) => Signer = (i) => ({ address: `0xaddr${i}`, privateKey: `k${i}` })): SweepContext & { lines: string[] } {
  const lines: string[] = [];
  return { network: "bsc", tokenContract: "0xtoken", tokenDecimals: 18, treasury: TREASURY, sweeper: chain, deriveSigner: derive, gasSigner: GAS, db, log: (l) => lines.push(l), txTimeoutMs: 0, lines };
}

describe("planSweep", () => {
  it("skips empty and below-threshold addresses and tops up only the deficit", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 0n, "0xaddr2": 5n, "0xaddr3": 50n, "0xaddr4": 70n }, native: { "0xaddr4": 30n } });
    const { db } = fakeDb([1, 2, 3, 4].map((i) => ({ address: `0xaddr${i}`, index: i })));
    const plan = await planSweep(ctx(chain.sweeper, db), { minTokenRaw: 10n, includeUnresolved: false });
    expect(plan.map((p) => (p.kind === "skip" ? `${p.candidate.addressIndex}:skip:${p.reason}` : `${p.candidate.addressIndex}:sweep:${p.tokenBalance}:topup ${p.topUp}`))).toEqual([
      "1:skip:empty",
      "2:skip:below_min",
      "3:sweep:50:topup 100",
      "4:sweep:70:topup 70",
    ]);
    // Only addresses that need a top-up cost the gas wallet the overhead.
    expect(gasNeeded(plan)).toBe(100n + 10n + 70n + 10n);
  });

  it("aborts the whole plan if any derived address differs from the deposit's", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n } });
    const { db } = fakeDb([{ address: "0xaddr1", index: 1 }, { address: "0xSOMEONE", index: 2 }]);
    await expect(planSweep(ctx(chain.sweeper, db), { minTokenRaw: 0n, includeUnresolved: false })).rejects.toThrow(AddressMismatchError);
  });

  it("compares BSC addresses case-insensitively and honours --limit", async () => {
    const chain = fakeChain({ token: { "0xABC1": 50n, "0xABC2": 50n } });
    const { db } = fakeDb([{ address: "0xABC1", index: 1 }, { address: "0xABC2", index: 2 }]);
    const plan = await planSweep(ctx(chain.sweeper, db, (i) => ({ address: `0xabc${i}`, privateKey: "k" })), { minTokenRaw: 0n, includeUnresolved: false, limit: 1 });
    expect(plan).toHaveLength(1);
  });
});

describe("executeSweep", () => {
  it("tops up, sweeps the whole balance to the treasury, and records the row lifecycle", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n }, native: { [GAS.address]: 1_000n } });
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }]);
    const c = ctx(chain.sweeper, db);
    const result = await executeSweep(c, await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false }));
    expect(result).toEqual({ confirmed: 1, failed: 0, pending: 0 });
    expect(chain.sends).toEqual(["native 0xgas->0xaddr1 100", `token 0xaddr1->${TREASURY} 50`]);
    expect(rows["row-1"]).toMatchObject({ status: "CONFIRMED", depositId: "dep-1", fromAddress: "0xaddr1", toAddress: TREASURY, rawAmount: 50n, gasTopUpRaw: 100n, gasTopUpTxHash: "0xgas1", sweepTxHash: "0xsweep2" });
  });

  it("re-quotes right before each sweep, so an earlier sweep making the next one cheaper strands no gas", async () => {
    // First transfer into a treasury that holds none of the token costs more
    // (new storage slot); once it holds some, the next quote drops.
    const chain = fakeChain({ token: { "0xaddr1": 50n, "0xaddr2": 60n }, native: { [GAS.address]: 1_000n } });
    let swept = 0;
    chain.sweeper.quoteSweep = async () => ({ ...QUOTE, requiredNative: swept > 0 ? 40n : 100n });
    const sendToken = chain.sweeper.sendToken;
    chain.sweeper.sendToken = async (...args) => {
      swept++;
      return sendToken(...args);
    };
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }, { address: "0xaddr2", index: 2 }]);
    const c = ctx(chain.sweeper, db);
    const plan = await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false });
    expect(plan.map((p) => (p.kind === "sweep" ? p.topUp : null))).toEqual([100n, 100n]); // planned at the upper bound
    await executeSweep(c, plan);
    expect(chain.sends).toEqual(["native 0xgas->0xaddr1 100", `token 0xaddr1->${TREASURY} 50`, "native 0xgas->0xaddr2 40", `token 0xaddr2->${TREASURY} 60`]);
    expect(rows["row-2"]).toMatchObject({ status: "CONFIRMED", gasTopUpRaw: 40n });
  });

  it("sends nothing when the gas wallet cannot fund the whole run", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n }, native: { [GAS.address]: 109n } });
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }]);
    const c = ctx(chain.sweeper, db);
    await expect(executeSweep(c, await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false }))).rejects.toThrow(InsufficientGasError);
    expect(chain.sends).toEqual([]);
    expect(rows).toEqual({});
  });

  it("a failure on one address is recorded and the run moves on", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n, "0xaddr2": 60n }, native: { [GAS.address]: 1_000n }, outcomes: ["failed"] });
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }, { address: "0xaddr2", index: 2 }]);
    const c = ctx(chain.sweeper, db);
    const result = await executeSweep(c, await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false }));
    expect(result).toEqual({ confirmed: 1, failed: 1, pending: 0 });
    expect(rows["row-1"]).toMatchObject({ status: "FAILED", error: expect.stringContaining("gas top-up failed on-chain") });
    expect(rows["row-2"]).toMatchObject({ status: "CONFIRMED" });
    expect(chain.sends.filter((s) => s.startsWith("token"))).toEqual([`token 0xaddr2->${TREASURY} 60`]);
  });

  it("a sweep tx that has not landed yet is left SUBMITTED", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n }, native: { "0xaddr1": 500n }, outcomes: ["pending"] });
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }]);
    const c = ctx(chain.sweeper, db);
    const result = await executeSweep(c, await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false }));
    expect(result).toEqual({ confirmed: 0, failed: 0, pending: 1 });
    expect(chain.sends).toEqual([`token 0xaddr1->${TREASURY} 50`]); // already funded: no top-up
    expect(rows["row-1"]).toMatchObject({ status: "SUBMITTED", sweepTxHash: "0xsweep1" });
  });

  it("records a thrown send as FAILED with its message", async () => {
    const chain = fakeChain({ token: { "0xaddr1": 50n }, native: { "0xaddr1": 500n }, failSend: "token" });
    const { db, rows } = fakeDb([{ address: "0xaddr1", index: 1 }]);
    const c = ctx(chain.sweeper, db);
    await executeSweep(c, await planSweep(c, { minTokenRaw: 0n, includeUnresolved: false }));
    expect(rows["row-1"]).toMatchObject({ status: "FAILED", error: "rejected" });
  });
});

describe("reconcileOpenSweeps", () => {
  it("settles open rows from the chain and fails rows interrupted before broadcast", async () => {
    const chain = fakeChain({ outcomes: ["success", "pending"] });
    const open = [
      { id: "a", fromAddress: "0x1", status: "SUBMITTED", sweepTxHash: "0xs1" },
      { id: "b", fromAddress: "0x2", status: "GAS_SENT", sweepTxHash: null },
      { id: "c", fromAddress: "0x3", status: "SUBMITTED", sweepTxHash: "0xs3" },
    ];
    const { db } = fakeDb([], open);
    const updates: [string, unknown][] = [];
    const original = db.update;
    db.update = async (id, patch) => {
      updates.push([id, patch]);
      return original(id, patch);
    };
    await reconcileOpenSweeps(ctx(chain.sweeper, db));
    expect(updates).toEqual([
      ["a", { status: "CONFIRMED" }],
      ["b", { status: "FAILED", error: "interrupted before the sweep tx was broadcast (was GAS_SENT)" }],
    ]);
  });
});
