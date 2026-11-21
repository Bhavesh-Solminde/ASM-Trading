import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  list: vi.fn(),
  transaction: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@asm/db", async (original) => ({
  ...await original<typeof import("@asm/db")>(),
  evaluateReferralQualification: mocks.evaluate,
  listUnqualifiedReferredUserIds: mocks.list,
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@asm/logger", () => ({ logger: mocks.log }));

import { OtcRuntime } from "../otc/runtime";
import {
  evaluateReferralAfterSettlement, markBotUser, runReferralQualificationSweep, startReferralQualificationSweep,
} from "./referral-qualification";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluate.mockResolvedValue({ outcome: "not_yet" });
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
