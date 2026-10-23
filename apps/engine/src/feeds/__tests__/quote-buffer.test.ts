import { describe, it, expect } from "vitest";
import { QuoteBuffer } from "../quote-buffer";
import type { Quote } from "../types";

describe("QuoteBuffer", () => {
  it("stores the latest quote per symbol", () => {
    const buf = new QuoteBuffer();
    const q1: Quote = { symbol: "BTCUSD", price: 95000, ts: 1000 };
    const q2: Quote = { symbol: "BTCUSD", price: 95100, ts: 2000 };

    buf.update(q1);
    expect(buf.latest("BTCUSD")).toEqual(q1);

    buf.update(q2);
    expect(buf.latest("BTCUSD")).toEqual(q2);
  });

  it("returns undefined for unknown symbols", () => {
    const buf = new QuoteBuffer();
    expect(buf.latest("UNKNOWN")).toBeUndefined();
  });

  it("tracks multiple symbols independently", () => {
    const buf = new QuoteBuffer();
    buf.update({ symbol: "BTCUSD", price: 95000, ts: 1000 });
    buf.update({ symbol: "ETHUSD", price: 3500, ts: 1000 });

    expect(buf.latest("BTCUSD")?.price).toBe(95000);
    expect(buf.latest("ETHUSD")?.price).toBe(3500);
  });

  it("ignores stale quotes (older timestamp)", () => {
    const buf = new QuoteBuffer();
    buf.update({ symbol: "BTCUSD", price: 95100, ts: 2000 });
    buf.update({ symbol: "BTCUSD", price: 95000, ts: 1000 });

    expect(buf.latest("BTCUSD")?.price).toBe(95100);
  });

  it("latestAll returns all symbols", () => {
    const buf = new QuoteBuffer();
    buf.update({ symbol: "BTCUSD", price: 95000, ts: 1000 });
    buf.update({ symbol: "ETHUSD", price: 3500, ts: 1000 });

    const all = buf.latestAll();
    expect(all.size).toBe(2);
    expect(all.get("BTCUSD")?.price).toBe(95000);
  });
});
