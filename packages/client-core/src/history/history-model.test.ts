import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  dayLabel,
  durationLabel,
  groupByDay,
  itemMatchesFilter,
  parseFilter,
  paymentItem,
  paymentMovedNoMoney,
  referenceFor,
  shortDate,
  splitAssetName,
  statusTone,
  tradePairName,
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

describe("status tone", () => {
  it("colours by meaning: done green, moving amber, failed red", () => {
    expect(statusTone("PAID")).toBe("up");
    expect(statusTone("WON")).toBe("up");
    expect(statusTone("HELD")).toBe("caution");
    expect(statusTone("AWAITING_PAYMENT")).toBe("caution");
    expect(statusTone("EXPIRED")).toBe("down");
    expect(statusTone("LOST")).toBe("down");
    expect(statusTone("REFUNDED")).toBe("neutral");
  });

  it("flags payments where no money moved", () => {
    for (const s of ["REJECTED", "EXPIRED", "CANCELLED_BY_USER", "AWAITING_PAYMENT"]) {
      expect(paymentMovedNoMoney(s)).toBe(true);
    }
    expect(paymentMovedNoMoney("PAID")).toBe(false);
  });
});

describe("trade labels", () => {
  it("prefers the asset's display pair", () => {
    expect(tradePairName(trade(), "EUR/USD (Forex)")).toBe("EUR/USD");
    expect(tradePairName(trade(), undefined)).toBe("EURUSD");
  });

  it("splits a display name into pair and market", () => {
    expect(splitAssetName("NIFTY 50 (India)")).toEqual({ pair: "NIFTY 50", market: "India" });
    expect(splitAssetName("BTC/USDT")).toEqual({ pair: "BTC/USDT", market: "" });
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
    expect(shortDate(new Date(2026, 9, 10), now)).toBe("Oct 10");
  });

  it("groups newest first by local day", () => {
    const groups = groupByDay([item(at(10, 9), "a"), item(at(12, 9), "b"), item(at(12, 14), "c"), item(at(11, 8), "d")], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Oct 10"]);
    expect(groups[0]!.items.map((i) => i.key)).toEqual(["c", "b"]);
  });
});

describe("payment items", () => {
  it("keys and times a payment row", () => {
    const item = paymentItem(row({ key: "w:9", kind: "withdrawal" }));
    expect(item.kind).toBe("withdrawal");
    expect(item.key).toBe("w:9");
    expect(item.atMs).toBe(new Date("2026-10-12T10:00:00.000Z").getTime());
  });

  it("makes a short reference from the id", () => {
    expect(referenceFor({ kind: "withdrawal", id: "8f3k2q1a-0000" })).toBe("WD-8F3K2Q1A");
    expect(referenceFor({ kind: "deposit", id: "1a2b3c4d-0000" })).toBe("DP-1A2B3C4D");
  });
});
