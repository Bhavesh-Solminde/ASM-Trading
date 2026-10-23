import { afterEach, expect, it, vi } from "vitest";
vi.mock("@asm/db", () => ({
  prisma: { candle: { upsert: vi.fn(async () => {}) } },
  autoPromoteHeldWithdrawals: async () => 0,
  istDateOf: () => "2026-10-24", listAffiliateAccountsNeedingReset: async () => [],
  resetAffiliateAccountFloat: vi.fn(),
}));
vi.mock("@asm/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });
it.each([
  ["EURUSD", "2026-10-24T12:00:00Z"], // weekend closure
  ["BTCUSDT", "2026-10-23T23:00:00Z"], // 04:30 IST maintenance
])("checks expiry during closed/frozen windows for %s", async (symbol, instant) => {
  vi.stubEnv("TRADING_MODEL", "CFD");
  vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
  const { startTickLoop } = await import("./loop");
  const scanPositions = vi.fn(async () => []);
  const recoverExpiredLegacy = vi.fn(async () => {});
  const registry = {
    all: () => [{ id: "asset", symbol, precision: 2 }],
    sigmaNow: () => 0.001, tick: () => ({ price: 100 }), record: () => [],
  };
  const loop = startTickLoop(registry as never, { broadcast: vi.fn() } as never,
    { recoverExpiredLegacy, collectDue: vi.fn(), preSettle: vi.fn(), openFor: () => [] }, {
      quoteBuffer: { latest: () => undefined } as never,
      gapTracker: { shownPrice: () => 100, converge: vi.fn() } as never,
      cfdDesk: { scanPositions } as never,
    });
  await vi.advanceTimersByTimeAsync(0);
  expect(recoverExpiredLegacy).toHaveBeenCalledOnce();
  expect(scanPositions).toHaveBeenCalledExactlyOnceWith("asset", symbol, 100, new Date(instant));
  loop.stop();
});
