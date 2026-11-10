import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  dayLabel,
  durationLabel,
  groupByDay,
  itemMatchesFilter,
  parseFilter,
  paymentAmountText,
  paymentItem,
  paymentMovedNoMoney,
  statusLabel,
  statusTone,
  tradeAmount,
  tradePairName,
  tradeTitle,
  type HistoryItem,
  type PaymentRow,
} from "./history-model";

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

describe("status wording and tone", () => {
  it("labels the statuses the way the mockups do", () => {
    expect(statusLabel("PENDING_CONFIRMATION")).toBe("Processing");
    expect(statusLabel("REQUESTED")).toBe("In review");
    expect(statusLabel("COMPLETED")).toBe("Credited");
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("colours by meaning: done green, moving amber, failed red", () => {
    expect(statusTone("PAID")).toBe("up");
    expect(statusTone("HELD")).toBe("caution");
    expect(statusTone("EXPIRED")).toBe("down");
    expect(statusTone("REFUNDED")).toBe("neutral");
  });
});

describe("amounts", () => {
  it("signs deposits + and withdrawals −", () => {
    expect(paymentAmountText(row())).toBe("+₹1,000.00");
    expect(paymentAmountText(row({ kind: "withdrawal", amountMinor: 500000 }))).toBe("−₹5,000.00");
  });

  it("flags payments where no money moved", () => {
    for (const s of ["REJECTED", "EXPIRED", "CANCELLED_BY_USER", "AWAITING_PAYMENT"]) {
      expect(paymentMovedNoMoney(s)).toBe(true);
    }
    expect(paymentMovedNoMoney("PAID")).toBe(false);
  });

  it("shows a win as stake plus profit, like the trades panel", () => {
    expect(tradeAmount(trade(), "INR")).toEqual({ text: "+₹193.00", tone: "up" });
    expect(tradeAmount(trade({ status: "LOST", pnl: -10000 }), "INR")).toEqual({ text: "−₹100.00", tone: "down" });
    // CFD: a profitable close reads like a win, a losing one shows only the loss.
    expect(tradeAmount(trade({ status: "CLOSED", pnl: 1000 }), "INR")).toEqual({ text: "+₹110.00", tone: "up" });
    expect(tradeAmount(trade({ status: "CLOSED", pnl: -1000 }), "INR")).toEqual({ text: "−₹10.00", tone: "down" });
  });
});

describe("trade labels", () => {
  it("titles by pair and side, and prefers the asset's display pair", () => {
    expect(tradeTitle(trade(), "NIFTY 50")).toBe("NIFTY 50 · Buy");
    expect(tradeTitle(trade({ direction: "DOWN" }), "BTC/USDT")).toBe("BTC/USDT · Sell");
    expect(tradePairName(trade(), "EUR/USD (Forex)")).toBe("EUR/USD");
    expect(tradePairName(trade(), undefined)).toBe("EURUSD");
  });

  it("formats durations", () => {
    expect(durationLabel(0, 30)).toBe("30s");
    expect(durationLabel(0, 60)).toBe("1m");
    expect(durationLabel(0, 90)).toBe("1m 30s");
    expect(durationLabel(0, 3600)).toBe("1h");
  });
});

describe("filtering", () => {
  it("falls back to all for unknown or disallowed values", () => {
    expect(parseFilter("deposits", ["all", "deposits"])).toBe("deposits");
    expect(parseFilter("trades", ["all", "deposits"])).toBe("all");
    expect(parseFilter(null, ["all"])).toBe("all");
  });

  it("matches each item kind to its filter", () => {
    const d = paymentItem(row());
    const w = paymentItem(row({ kind: "withdrawal", key: "w:1" }));
    expect(itemMatchesFilter(d, "deposits")).toBe(true);
    expect(itemMatchesFilter(d, "withdrawals")).toBe(false);
    expect(itemMatchesFilter(w, "withdrawals")).toBe(true);
    expect(itemMatchesFilter(w, "all")).toBe(true);
    const t: HistoryItem = { kind: "trade", key: "t:1", atMs: 0, trade: trade(), currency: "INR", pair: "EUR/USD" };
    expect(itemMatchesFilter(t, "trades")).toBe(true);
    expect(itemMatchesFilter(t, "deposits")).toBe(false);
  });
});

describe("day grouping", () => {
  const now = new Date(2026, 9, 12, 15, 0);
  const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).getTime();
  const item = (atMs: number, key: string): HistoryItem => ({ ...paymentItem(row({ key })), atMs });

  it("labels Today, Yesterday and older dates", () => {
    expect(dayLabel(new Date(2026, 9, 12, 1), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 11, 23), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 10, 9), now)).toBe("Oct 10");
    expect(dayLabel(new Date(2025, 11, 31, 9), now)).toBe("Dec 31, 2025");
  });

  it("groups newest first by local day", () => {
    const groups = groupByDay([item(at(10, 9), "a"), item(at(12, 9), "b"), item(at(12, 14), "c"), item(at(11, 8), "d")], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Oct 10"]);
    expect(groups[0]!.items.map((i) => i.key)).toEqual(["c", "b"]);
  });
});
