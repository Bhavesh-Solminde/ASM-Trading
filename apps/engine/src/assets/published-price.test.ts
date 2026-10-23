import { afterEach, expect, it, vi } from "vitest";
vi.mock("@asm/db", () => ({ prisma: {
  asset: { findMany: async () => [{
    id: "sensex", symbol: "SENSEX", kind: "REAL", payoutPct: 80,
    precision: 2, tickSize: 0.01, basePrice: 81678.61,
    intradayProfile: "INDEX", msmSigma: 0.00002, msmM0: 1.45, anchorAlpha: 0.08,
  }] },
  candle: { findFirst: async () => null },
} }));
vi.mock("@asm/logger", () => ({ logger: { info: vi.fn() } }));
import { AssetRegistry } from "./registry";
afterEach(() => vi.useRealTimers());
it("keeps execution and candle prices together even when the model and anchor differ", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  const registry = new AssetRegistry(123);
  await registry.loadSymbols(["SENSEX"]);
  expect(registry.publishedPrice("SENSEX")).toBe(0);
  registry.record("SENSEX", Date.now() / 1000, 81638.004);
  registry.setAnchor("SENSEX", 82000);
  const asset = registry.get("SENSEX")!;
  asset.state = { ...asset.state, price: 81678.61 };
  expect(registry.publishedPrice("SENSEX")).toBe(81638);
  expect(registry.formingCandle("SENSEX", "1m")?.c).toBe(81638);
  vi.advanceTimersByTime(16000);
  expect(registry.publishedPrice("SENSEX")).toBe(0);
});
