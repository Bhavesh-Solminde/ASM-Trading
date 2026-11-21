import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  promote: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@asm/db", () => ({ autoPromoteHeldWithdrawals: mocks.promote }));
vi.mock("@asm/logger", () => ({ logger: mocks.log }));

import { startHeldWithdrawalRelease } from "./held-release";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const saved = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.promote.mockResolvedValue(0);
});
afterEach(() => { process.env = { ...saved }; });

describe("held withdrawal release job", () => {
  it("releases expired holds on schedule and logs only when it moved some", async () => {
    process.env["WITHDRAWAL_HOLD_RELEASE_INTERVAL_MS"] = "5";
    mocks.promote.mockResolvedValueOnce(2);
    const job = startHeldWithdrawalRelease();
    await sleep(60);
    await job.stop();
    expect(mocks.promote.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.promote.mock.calls[0]![0]).toBeInstanceOf(Date);
    expect(mocks.log.info).toHaveBeenCalledTimes(1);
    expect(mocks.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "withdrawal.hold_auto_promoted", count: 2 }), expect.any(String));
  });

  it("never overlaps runs and keeps going after a failed run", async () => {
    process.env["WITHDRAWAL_HOLD_RELEASE_INTERVAL_MS"] = "5";
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.promote.mockRejectedValueOnce(new Error("db down")).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(30);
      inFlight -= 1;
      return 0;
    });
    const job = startHeldWithdrawalRelease();
    await sleep(150);
    await job.stop();
    expect(mocks.promote.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(maxInFlight).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "withdrawal.hold_auto_promote_failed", reason: "db down" }), expect.any(String));
  });

  it("stops scheduling after stop()", async () => {
    process.env["WITHDRAWAL_HOLD_RELEASE_INTERVAL_MS"] = "5";
    const job = startHeldWithdrawalRelease();
    await sleep(30);
    await job.stop();
    const calls = mocks.promote.mock.calls.length;
    await sleep(30);
    expect(mocks.promote.mock.calls.length).toBe(calls);
  });

  it("runs once a minute by default", async () => {
    vi.useFakeTimers();
    try {
      delete process.env["WITHDRAWAL_HOLD_RELEASE_INTERVAL_MS"];
      const job = startHeldWithdrawalRelease();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(mocks.promote).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.promote).toHaveBeenCalledTimes(1);
      await job.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
