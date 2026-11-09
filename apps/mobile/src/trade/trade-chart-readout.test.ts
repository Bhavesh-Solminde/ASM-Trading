import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  phase: "authed", chart: { symbol: "NIFTY50", timeframe: "1m", generation: "worker-a", candles: [], forming: null, lastPrice: 24900, displayQuote: { token: "displayed", price: 24968.73, expiresAt: 9999999999999 } }, trades: { tradesByAccount: {} },
}));
vi.mock("react-native", () => ({ View: "div" }));
vi.mock("@/theme/ui", () => ({ Txt: "span" }));
vi.mock("@/socket/socket-store", () => ({ useSocket: (select: (s: typeof state) => unknown) => select(state) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./protection-store", () => ({ useProtection: () => ({ enabled: false }) }));
vi.mock("./useNow", () => ({ useNow: () => Date.now() }));
vi.mock("@/chart/Chart", () => ({ Chart: ({ priceReadout }: { priceReadout: ReactNode }) => priceReadout }));
import { TradeChart } from "./TradeChart";
it("mounts the quote-committing price readout in the chart header, showing the quote rather than a different tick", () => {
  const html = renderToStaticMarkup(createElement(TradeChart, { symbol: "NIFTY50", timeframe: "1m", type: "candles", precision: 2, accountId: null, snapshot: null, tradesSnapshot: null }));
  expect(html).toContain("24,968.73");
  expect(html).not.toContain("24,900");
});
