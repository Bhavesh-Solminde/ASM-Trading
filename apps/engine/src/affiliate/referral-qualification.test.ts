import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  list: vi.fn(),
  settleTrade: vi.fn(),
  transaction: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@asm/db", async (original) => ({
  ...await original<typeof import("@asm/db")>(),
  evaluateReferralQualification: mocks.evaluate,
  listUnqualifiedReferredUserIds: mocks.list,
  settleTrade: mocks.settleTrade,
  recordSettledTrade: vi.fn(async () => {}),
  applySettlementToHouseDay: vi.fn(async () => {}),
  applySettlementToTreasury: vi.fn(async () => {}),
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@asm/logger", () => ({ logger: mocks.log }));

import { TradeDesk } from "../trading/trade-desk";
import { CfdDesk } from "../trading/cfd-desk";
import { OtcRuntime } from "../otc/runtime";
import {
  evaluateReferralAfterSettlement, markBotUser, runReferralQualificationSweep, startReferralQualificationSweep,
} from "./referral-qualification";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const failedLogged = () => mocks.log.error.mock.calls.some(([o]) => (o as { evt?: string }).evt === "referral.evaluate_failed");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluate.mockResolvedValue({ outcome: "not_yet" });
});

describe("legacy binary settlement hook", () => {
  async function settle(isDemo: boolean) {
    mocks.settleTrade.mockResolvedValue({ userId: "user", realBalance: 1, bonusBalance: 0,
      trade: { id: "t1", accountId: "acc", entryTs: new Date(0), expiryTs: new Date(60_000), status: "WON", stake: 1000, pnl: 920 } });
    const sendToUser = vi.fn();
    const desk = new TradeDesk({ all: () => [] } as never, { sendToUser, broadcast: vi.fn() } as never, { invalidate: vi.fn() } as never);
    const internal = desk as unknown as { pending: unknown[]; drain(): Promise<void> };
    internal.pending.push({
      position: { tradeId: "t1", accountId: "acc", assetId: "asset", direction: "UP", stake: 1000, payoutPct: 92, isDemo, expirySec: 60 },
      symbol: "BTCUSDT", exitPrice: 1, honestExitPrice: 1, resolvedExitPrice: 1, attempts: 0,
    });
    await internal.drain();
    await flush();
    return { sendToUser };
  }

  it("evaluates the owner after a LIVE settlement", async () => {
    await settle(false);
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith("user");
  });

  it("does not evaluate after a DEMO settlement", async () => {
    await settle(true);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("a throwing evaluation does not break the settlement", async () => {
    mocks.evaluate.mockImplementation(() => { throw new Error("db down"); });
    const { sendToUser } = await settle(false);
    expect(sendToUser).toHaveBeenCalledWith("user", expect.objectContaining({ type: "trade:settled" }));
    expect(failedLogged()).toBe(true);
  });
});

describe("CFD close hook", () => {
  async function close(type: "LIVE" | "DEMO") {
    mocks.transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => fn({
      trade: { updateMany: async () => ({ count: 1 }) },
      account: { update: async () => {}, findUnique: async () => ({ type, userId: "cfd-user" }) },
      houseTreasury: { upsert: async () => {} },
    }));
    const result = await new CfdDesk().closePosition({ id: "c1", accountId: "acc", direction: "UP",
      entryPrice: 100, stake: 10_000, stakeFromBonus: 0, leverage: 1 }, "DURATION", 101, new Date());
    await flush();
    return result;
  }

  it("evaluates after a LIVE close, not after a DEMO close", async () => {
    await close("DEMO");
    expect(mocks.evaluate).not.toHaveBeenCalled();
    await close("LIVE");
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith("cfd-user");
  });

  it("a rejecting evaluation does not break the close", async () => {
    mocks.evaluate.mockRejectedValue(new Error("db down"));
    expect((await close("LIVE")).tradeId).toBe("c1");
    expect(failedLogged()).toBe(true);
  });
});

describe("OTC settlement hook", () => {
  async function run(type: "LIVE" | "DEMO") {
    const client = { account: { findUnique: vi.fn(async () => ({ type })) } };
    const runtime = new OtcRuntime(client as never, "");
    (runtime as unknown as { evaluateReferral(s: object): void }).evaluateReferral({ id: "o1", accountId: "acc", actorId: "otc-user" });
    await flush();
    await flush();
  }

  it("evaluates LIVE accounts only", async () => {
    await run("DEMO");
    expect(mocks.evaluate).not.toHaveBeenCalled();
    await run("LIVE");
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith("otc-user");
  });
});

describe("settlement-triggered evaluation limiter", () => {
  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 500 && !predicate(); i++) await sleep(2);
    expect(predicate()).toBe(true);
  }
  function gated() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let inFlight = 0;
    let max = 0;
    mocks.evaluate.mockImplementation(async () => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await gate;
      inFlight -= 1;
      return { outcome: "not_yet" };
    });
    return { release, max: () => max, inFlight: () => inFlight };
  }

  it("runs at most 4 at once, never blocks the caller, and finishes every queued user", async () => {
    const g = gated();
    for (let i = 0; i < 20; i++) evaluateReferralAfterSettlement(`c${i}`, `t${i}`); // returns synchronously
    await flush();
    expect(g.inFlight()).toBe(4);
    g.release();
    await waitFor(() => mocks.evaluate.mock.calls.length === 20 && g.inFlight() === 0);
    expect(g.max()).toBe(4);
  });

  it("collapses duplicates for a user already queued or in flight", async () => {
    const g = gated();
    for (let i = 0; i < 5; i++) evaluateReferralAfterSettlement("dup", `t${i}`);
    g.release();
    await waitFor(() => g.inFlight() === 0 && mocks.evaluate.mock.calls.length >= 1);
    await flush();
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith("dup");
  });

  it("drops beyond the bounded queue without throwing", async () => {
    const g = gated();
    expect(() => { for (let i = 0; i < 1_010; i++) evaluateReferralAfterSettlement(`o${i}`, "t"); }).not.toThrow();
    // 4 in flight + 1,000 queued accepted; the remaining 6 are left to the sweep.
    expect(mocks.log.debug).toHaveBeenCalledTimes(6);
    g.release();
    await waitFor(() => mocks.evaluate.mock.calls.length === 1_004 && g.inFlight() === 0);
  });

  it("skips known bot users", async () => {
    markBotUser("bot-1");
    evaluateReferralAfterSettlement("bot-1", "t");
    await flush();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});

describe("referral qualification sweep", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("evaluates every id in order and keeps going after a failure", async () => {
    mocks.list.mockResolvedValue(["a", "b", "c"]);
    mocks.evaluate.mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("boom");
      return { outcome: id === "c" ? "qualified" : "not_yet" };
    });
    expect(await runReferralQualificationSweep()).toEqual({ checked: 3, qualified: 1, failed: 1, nextAfterId: undefined });
    expect(mocks.list).toHaveBeenCalledWith(200, undefined);
    expect(mocks.evaluate.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("pages through a full batch and wraps around after a short one", async () => {
    const full = Array.from({ length: 200 }, (_, i) => `u${String(i).padStart(3, "0")}`);
    mocks.list.mockResolvedValueOnce(full).mockResolvedValueOnce(["z"]);
    expect((await runReferralQualificationSweep()).nextAfterId).toBe("u199");
    expect((await runReferralQualificationSweep("u199")).nextAfterId).toBeUndefined();
    expect(mocks.list.mock.calls).toEqual([[200, undefined], [200, "u199"]]);
  });

  it("never overlaps runs and survives a failed run", async () => {
    process.env["REFERRAL_QUALIFICATION_SWEEP_INTERVAL_MS"] = "5";
    mocks.list.mockRejectedValueOnce(new Error("list failed")).mockResolvedValue(["x"]);
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.evaluate.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(30);
      inFlight -= 1;
      return { outcome: "not_yet" };
    });
    const sweep = startReferralQualificationSweep();
    await sleep(200);
    await sweep.stop();
    expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(expect.objectContaining({ evt: "referral.sweep.tick_error" }), expect.any(String));
    expect(mocks.log.info).toHaveBeenCalledWith(expect.objectContaining({ evt: "referral.sweep.run", checked: 1 }), expect.any(String));
  });

  it("is disabled by REFERRAL_QUALIFICATION_SWEEP_ENABLED=false", async () => {
    process.env["REFERRAL_QUALIFICATION_SWEEP_ENABLED"] = "false";
    process.env["REFERRAL_QUALIFICATION_SWEEP_INTERVAL_MS"] = "5";
    const sweep = startReferralQualificationSweep();
    await sleep(40);
    await sweep.stop();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
