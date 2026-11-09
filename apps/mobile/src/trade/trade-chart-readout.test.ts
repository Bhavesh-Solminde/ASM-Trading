import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  phase: "authed", chart: { symbol: "NIFTY50", timeframe: "1m", generation: "worker-a", candles: [], forming: null, lastPrice: 24900, displayQuote: { token: "displayed", price: 24968.73, expiresAt: 9999999999999 } }, trades: { tradesByAccount: {} },
}));
vi.mock("react", async () => ({ ...await vi.importActual("react"), useMemo: (compute: () => unknown) => compute(), useCallback: (callback: unknown) => callback }));
vi.mock("react-native", () => ({ View: "div" }));
vi.mock("@/theme/ui", () => ({ Txt: "span" }));
vi.mock("@/socket/socket-store", () => ({ useSocket: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./protection-store", () => ({ useProtection: () => ({ enabled: false }) }));
vi.mock("./useNow", () => ({ useNow: () => Date.now() }));
vi.mock("@/chart/Chart", () => ({ Chart: () => null }));
import { TradeChart } from "./TradeChart";
import { PriceReadout } from "./PriceReadout";
it("mounts the quote-committing price readout in the chart header", () => {
  const tree = TradeChart({ symbol: "NIFTY50", timeframe: "1m", type: "candles", precision: 2, accountId: null, snapshot: null, tradesSnapshot: null });
  const readout = tree.props.children.props.priceReadout;
  expect(readout.type).toBe(PriceReadout);
  expect(readout.props).toEqual({ symbol: "NIFTY50", precision: 2 });
});
