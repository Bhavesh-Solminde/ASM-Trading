import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/components/shell/PlatformProvider", () => ({ useQuote: () => ({ price: 110 }) }));
vi.mock("@/lib/use-now", () => ({ useNowSec: () => 100 }));
vi.mock("./AssetIcon", () => ({ AssetIcon: () => null }));
import { TradesPanel } from "./TradesPanel";
it("does not claim an outcome while an expired trade is still OPEN", () => {
  const html = renderToStaticMarkup(createElement(TradesPanel, { currency: "INR", assets: [], trades: [{
    id: "t", accountId: "a", symbol: "BTCUSDT", direction: "UP", stake: 250000,
    payoutPct: 92, entryPrice: 100, entryTs: 60, expiryTs: 90, exitPrice: null,
    status: "OPEN", pnl: 0,
  }] }));
  expect(html).toContain("Settling");
  expect(html).not.toContain(">Won<");
  expect(html).not.toContain(">Lost<");
});

it("shows proportional net PnL for an open CFD", () => {
  const html = renderToStaticMarkup(createElement(TradesPanel, { currency: "INR", assets: [], trades: [{
    id: "cfd", accountId: "a", symbol: "BTCUSDT", direction: "UP", stake: 10000,
    payoutPct: 0, durationSec: 30, entryPrice: 100, entryTs: 90, expiryTs: 120,
    exitPrice: null, status: "OPEN", pnl: 0,
  }] }));
  expect(html).toContain("+₹10.00");
  expect(html).not.toContain("+₹100.00");
});
