import { afterEach, expect, it, vi } from "vitest";
import { clearDisplayedQuote, displayedQuoteFor } from "./displayed-quote";
const state = vi.hoisted(() => ({
  chart: { symbol: "NIFTY50", timeframe: "1m", generation: "worker-a", displayQuote: { token: "shown", price: 24968.73, expiresAt: 9999999999999 } },
  effects: [] as (() => void | (() => void))[],
}));
vi.mock("react", async () => ({ ...await vi.importActual("react"), useLayoutEffect: (effect: () => void | (() => void)) => state.effects.push(effect) }));
vi.mock("@/socket/socket-store", () => ({ useSocket: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("@/theme/ui", () => ({ Txt: () => null }));
import { PriceReadout } from "./PriceReadout";
afterEach(() => { clearDisplayedQuote(); state.effects = []; });
it("records the exact rendered quote only after the price readout commits, and clears on unmount", () => {
  const rendered = PriceReadout({ symbol: "NIFTY50", precision: 2 });
  expect(rendered.props.children).toContain("24,968.73");
  expect(displayedQuoteFor("NIFTY50", "1m", "worker-a")).toBeNull();
  const cleanup = state.effects[0]!();
  expect(displayedQuoteFor("NIFTY50", "1m", "worker-a")?.token).toBe("shown");
  expect(displayedQuoteFor("NIFTY50", "1m", "worker-a")?.price).toBe(state.chart.displayQuote.price);
  if (cleanup) cleanup();
  expect(displayedQuoteFor("NIFTY50", "1m", "worker-a")).toBeNull();
});
it("does not authorize a cached price from a different market", () => {
  PriceReadout({ symbol: "BTCUSDT", precision: 2 });
  state.effects[0]!();
  expect(displayedQuoteFor("BTCUSDT", "1m", "worker-a")).toBeNull();
});
