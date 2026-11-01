import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("@/components/trade/TradeWorkspace", () => ({ TradeWorkspace: () => null }));
import TradePage from "./page";
afterEach(() => vi.unstubAllEnvs());
it("uses the runtime server mode even if the old public flag says binary", async () => {
  vi.stubEnv("TRADING_MODEL", "CFD");
  vi.stubEnv("NEXT_PUBLIC_TRADING_MODEL", "BINARY");
  expect((await TradePage()).props.tradingModel).toBe("CFD");
});
it("defaults to binary without a runtime CFD setting", async () => {
  vi.stubEnv("TRADING_MODEL", "BINARY");
  vi.stubEnv("NEXT_PUBLIC_TRADING_MODEL", "CFD");
  expect((await TradePage()).props.tradingModel).toBe("BINARY");
});
