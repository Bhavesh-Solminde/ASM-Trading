import { describe, expect, it } from "vitest";
import { applyQuoteMessage, changePct, initialQuotes, tickDirection } from "./quotes";

const base = initialQuotes([{ symbol: "EURUSD", payoutPct: 92 }]);

describe("applyQuoteMessage", () => {
  it("measures change from the oldest candle in history", () => {
    let q = applyQuoteMessage(base, {
      type: "candles:history",
      symbol: "EURUSD",
      timeframe: "1m",
      candles: [
        { openTs: 0, o: 100, h: 101, l: 99, c: 100 },
        { openTs: 60, o: 100, h: 102, l: 100, c: 101 },
      ],
    });
    expect(q.EURUSD!.price).toBe(101);
    q = applyQuoteMessage(q, { type: "tick", symbol: "EURUSD", price: 102, ts: 120 });
    expect(changePct(q.EURUSD!)).toBeCloseTo(2);
  });

  it("remembers the previous price so the flash knows its direction", () => {
    let q = applyQuoteMessage(base, { type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
    expect(tickDirection(q.EURUSD!)).toBeNull();
    q = applyQuoteMessage(q, { type: "tick", symbol: "EURUSD", price: 1.09, ts: 2 });
    expect(tickDirection(q.EURUSD!)).toBe("down");
  });

  it("returns the same object for messages that change nothing", () => {
    expect(applyQuoteMessage(base, { type: "tick", symbol: "OTHER", price: 1, ts: 1 })).toBe(base);
    expect(applyQuoteMessage(base, { type: "payout:update", symbol: "EURUSD", payoutPct: 92 })).toBe(base);
  });
});
