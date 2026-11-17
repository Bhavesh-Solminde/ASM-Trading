import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@asm/db", () => ({ closeDueProgramDays: mocks.close }));
vi.mock("@asm/logger", () => ({ logger: mocks.log }));

import { startProgramDayClose } from "./program-day-close";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const saved = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue({ closedDays: [] });
});
afterEach(() => { process.env = { ...saved }; });

describe("program day close job", () => {
  it("runs on schedule with the current time and logs the closed days", async () => {
    process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"] = "5";
    mocks.close.mockResolvedValueOnce({ closedDays: ["2026-11-13"] });
    const job = startProgramDayClose();
    await sleep(60);
    await job.stop();
    expect(mocks.close.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.close.mock.calls[0]![0]).toBeInstanceOf(Date);
    expect(mocks.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "program.day_close.run", closedDays: ["2026-11-13"] }), expect.any(String));
  });

  it("never overlaps runs and continues after a failed run", async () => {
    process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"] = "5";
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.close.mockRejectedValueOnce(new Error("db down")).mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(30);
      inFlight -= 1;
      return { closedDays: [] };
    });
    const job = startProgramDayClose();
    await sleep(150);
    await job.stop();
    expect(mocks.close.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(maxInFlight).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "program.day_close.tick_error", reason: "db down" }), expect.any(String));
  });

  it("stops scheduling after stop()", async () => {
    process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"] = "5";
    const job = startProgramDayClose();
    await sleep(30);
    await job.stop();
    const calls = mocks.close.mock.calls.length;
    await sleep(30);
    expect(mocks.close.mock.calls.length).toBe(calls);
  });

  it("defaults to a 5-minute interval", async () => {
    vi.useFakeTimers();
    try {
      delete process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"];
      const job = startProgramDayClose();
      await vi.advanceTimersByTimeAsync(299_999);
      expect(mocks.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.close).toHaveBeenCalledTimes(1);
      await job.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is disabled by PROGRAM_DAY_CLOSE_ENABLED=false", async () => {
    process.env["PROGRAM_DAY_CLOSE_ENABLED"] = "false";
    process.env["PROGRAM_DAY_CLOSE_INTERVAL_MS"] = "5";
    const job = startProgramDayClose();
    await sleep(40);
    await job.stop();
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
