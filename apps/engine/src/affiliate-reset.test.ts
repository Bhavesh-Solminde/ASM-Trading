import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAffiliateResetRunner } from "./affiliate-reset";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reset: vi.fn(), error: vi.fn() }));
vi.mock("@asm/db", () => ({
  prisma: {},
  istDateOf: () => "2026-11-10",
  listAffiliateAccountsNeedingReset: mocks.list,
  resetAffiliateAccountFloat: mocks.reset,
}));
vi.mock("@asm/logger", () => ({ logger: { error: mocks.error } }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(["live", "demo"]);
  mocks.reset.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

it("runs at startup and every minute, then stops scheduling", async () => {
  const runner = startAffiliateResetRunner();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.reset.mock.calls.map(([input]) => input.accountId)).toEqual(["live", "demo"]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.list).toHaveBeenCalledTimes(2);
  await runner.stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it("waits for in-flight resets on shutdown and never overlaps scans", async () => {
  let release!: () => void;
  mocks.reset.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const runner = startAffiliateResetRunner();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = runner.stop().then(() => { stopped = true; });
  expect(stopped).toBe(false);
  release();
  await stopping;
  expect(mocks.reset).toHaveBeenCalledTimes(2);
});

it("continues other accounts on failure and retries the next scan", async () => {
  mocks.reset.mockRejectedValueOnce(new Error("temporary account failure"));
  const runner = startAffiliateResetRunner();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.reset).toHaveBeenCalledTimes(2);
  expect(mocks.error).toHaveBeenCalledTimes(1);
  mocks.list.mockRejectedValueOnce(new Error("temporary scan failure"));
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.reset).toHaveBeenCalledTimes(4);
  await runner.stop();
});
