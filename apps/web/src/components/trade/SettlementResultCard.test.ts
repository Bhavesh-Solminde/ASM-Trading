import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TradeView } from "@asm/contracts";
import { expect, it } from "vitest";
import { SettlementResultCard } from "./SettlementResultCard";

const trade: TradeView = {
  id: "doge", accountId: "demo", symbol: "DOGEUSDT", direction: "DOWN",
  stake: 100000, spreadFee: 50, entryPrice: 0.07634, exitPrice: 0.07621,
  entryTs: 100, expiryTs: 200, payoutPct: 0, status: "CLOSED", pnl: 17029,
};

it.each([
  { status: "CLOSED", pnl: 17029, amount: "+₹170.29", color: "bg-up text-up-ink" },
  { status: "CLOSED", pnl: -17029, amount: "−₹170.29", color: "bg-down text-down-ink" },
  { status: "CLOSED", pnl: 0, amount: "₹0.00", color: "bg-tile text-ink" },
  { status: "WON", pnl: 85000, amount: "+₹1,850.00", color: "bg-up text-up-ink" },
  { status: "LOST", pnl: -100000, amount: "−₹1,000.00", color: "bg-down text-down-ink" },
  { status: "REFUNDED", pnl: 0, amount: "₹0.00", color: "bg-tile text-ink" },
] as const)("renders $status with PnL $pnl as $amount with the matching color", ({ status, pnl, amount, color }) => {
  const html = renderToStaticMarkup(createElement(SettlementResultCard, {
    trade: { ...trade, status, pnl }, currency: "INR", pair: "DOGE/USDT", onDismiss: () => {},
  }));
  expect(html).toContain(`>${amount}</span>`);
  expect(html).toContain(color);
  expect(html).toContain(`${status === "WON" ? "Payout" : "Result"} · DOGE/USDT`);
});
