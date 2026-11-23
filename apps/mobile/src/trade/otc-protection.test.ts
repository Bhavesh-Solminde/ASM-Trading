import type { TradeView } from "@asm/contracts";
import { expect, it } from "vitest";
import { canEditStops, clampStops, focusedStopTrade, initialStops } from "./otc-protection";

const trade: TradeView = {
  id: "a", accountId: "acct", symbol: "OTC_GOLD", mode: "OTC_FIXED", direction: "UP",
  entryPrice: 100, entryTs: 90, expiryTs: 180, status: "OPEN",
  stake: 1000, payoutPct: 92, exitPrice: null, pnl: 0,
};

it("starts the draft at the previous default distance from the current price", () => {
  expect(initialStops(trade, 100, 2)).toEqual({ stopLoss: 99.85, takeProfit: 100.15 });
  expect(initialStops({ ...trade, direction: "DOWN" }, 100, 2)).toEqual({ stopLoss: 100.15, takeProfit: 99.85 });
});

it("keeps both directions beyond entry and live price, including rounded boundary values", () => {
  expect(initialStops(trade, 101, 2)).toEqual({ stopLoss: 99.99, takeProfit: 101.15 });
  expect(initialStops({ ...trade, direction: "DOWN" }, 101, 2)).toEqual({ stopLoss: 101.15, takeProfit: 99.99 });
  expect(clampStops({ stopLoss: 105.25, takeProfit: 100 }, trade, 101.002, 2)).toEqual({ stopLoss: 99.99, takeProfit: 101.01 });
  expect(clampStops({ stopLoss: null, takeProfit: 101 }, { ...trade, direction: "DOWN" }, 99.998, 2)).toEqual({ stopLoss: null, takeProfit: 99.99 });
});

it("uses a positive level when possible and omits a side with no positive tick", () => {
  expect(initialStops({ ...trade, entryPrice: 0.03 }, 0.03, 2)).toEqual({ stopLoss: 0.01, takeProfit: 0.08 });
  expect(initialStops({ ...trade, entryPrice: 0.01 }, 0.01, 2)).toEqual({ stopLoss: null, takeProfit: 0.06 });
});

it("chooses the focused position, falls back to the newest, and excludes expired/non-OTC trades", () => {
  const newer = { ...trade, id: "b", entryTs: 100, expiryTs: 190 };
  const other = { ...trade, id: "c", mode: "CFD" as const, entryTs: 110 };
  expect(focusedStopTrade([newer, trade, other], "a", 120_000)).toBe(trade);
  expect(focusedStopTrade([trade, other, newer], "c", 120_000)).toBe(newer);
  expect(focusedStopTrade([trade, newer], "a", 180_000)).toBe(newer);
  expect(canEditStops({ ...trade, pending: true }, 120_000)).toBe(false);
});
