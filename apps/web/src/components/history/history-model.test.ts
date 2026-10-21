import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  groupByDay,
  paymentAmountText,
  paymentItem,
  statusLabel,
  statusTone,
  tradeAmount,
  tradeTitle,
  type PaymentRow,
} from "./history-model";

// The pure rules (tone, filtering, day grouping, durations) are tested in @asm/client-core, where they live.
// This file covers the web-only wording and the re-exports the history components import from here.

const row = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  key: "d:1",
  id: "1",
  kind: "deposit",
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: null,
  status: "COMPLETED",
  methodLabel: "UPI",
  amountMinor: 100000,
  currency: "INR",
  destination: null,
  expiresAt: null,
  holdUntil: null,
  cancelableUntil: null,
  ...over,
});

const trade = (over: Partial<TradeView> = {}): TradeView => ({
  id: "t1",
  accountId: "a1",
  symbol: "EURUSD",
  direction: "UP",
  stake: 10000,
  payoutPct: 93,
  entryPrice: 1.1,
  entryTs: 1_760_000_000,
  expiryTs: 1_760_000_030,
  exitPrice: 1.2,
  status: "WON",
  pnl: 9300,
  ...over,
});

describe("status wording", () => {
  it("labels the statuses the way the mockups do", () => {
    expect(statusLabel("PENDING_CONFIRMATION")).toBe("Processing");
    expect(statusLabel("REQUESTED")).toBe("In review");
    expect(statusLabel("COMPLETED")).toBe("Credited");
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("amounts", () => {
  it("signs deposits + and withdrawals −", () => {
    expect(paymentAmountText(row())).toBe("+₹1,000.00");
    expect(paymentAmountText(row({ kind: "withdrawal", amountMinor: 500000 }))).toBe("−₹5,000.00");
  });

  it("shows a win as stake plus profit, like the trades panel", () => {
    expect(tradeAmount(trade(), "INR")).toEqual({ text: "+₹193.00", tone: "up" });
    expect(tradeAmount(trade({ status: "LOST", pnl: -10000 }), "INR")).toEqual({ text: "−₹100.00", tone: "down" });
  });
});

describe("trade labels", () => {
  it("titles by pair and side", () => {
    expect(tradeTitle(trade(), "NIFTY 50")).toBe("NIFTY 50 · Buy");
    expect(tradeTitle(trade({ direction: "DOWN" }), "BTC/USDT")).toBe("BTC/USDT · Sell");
  });
});

describe("re-exports from client-core", () => {
  it("still serve the history components", () => {
    expect(statusTone("PAID")).toBe("up");
    expect(groupByDay([paymentItem(row())], new Date(2026, 9, 12, 15, 0))).toHaveLength(1);
  });
});
