import { describe, expect, it } from "vitest";
import { parseBinanceQuote } from "./binance";

const BY_SYMBOL = { BTCUSDT: "BTCUSD" };

describe("parseBinanceQuote", () => {
  it("parses a combined-stream miniTicker frame into an internal quote", () => {
    const raw = JSON.stringify({
      stream: "btcusdt@miniTicker",
      data: { e: "24hrMiniTicker", E: 1792849000000, s: "BTCUSDT", c: "95012.34", o: "94000", h: "96000", l: "93000" },
    });
    const quote = parseBinanceQuote(raw, BY_SYMBOL);
    expect(quote?.symbol).toBe("BTCUSD");
    expect(quote?.price).toBe(95012.34);
    expect(quote?.ts).toBe(1792849000);
  });

  it("parses a single-stream frame that is the payload itself", () => {
    const raw = JSON.stringify({ e: "24hrMiniTicker", E: 1792849000000, s: "BTCUSDT", c: "95500.00" });
    expect(parseBinanceQuote(raw, BY_SYMBOL)?.price).toBe(95500);
  });

  it("returns null for a symbol we do not track", () => {
    const raw = JSON.stringify({ data: { s: "ETHUSDT", c: "3000" } });
    expect(parseBinanceQuote(raw, BY_SYMBOL)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseBinanceQuote("not json", BY_SYMBOL)).toBeNull();
  });

  it("returns null when the price is missing, zero or non-numeric", () => {
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "BTCUSDT" } }), BY_SYMBOL)).toBeNull();
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "BTCUSDT", c: "0" } }), BY_SYMBOL)).toBeNull();
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "BTCUSDT", c: "abc" } }), BY_SYMBOL)).toBeNull();
  });

  it("matches the Binance symbol case-insensitively", () => {
    const raw = JSON.stringify({ data: { E: 1792849000000, s: "btcusdt", c: "42.5" } });
    expect(parseBinanceQuote(raw, BY_SYMBOL)?.symbol).toBe("BTCUSD");
  });
});

it("rejects quotes without an exchange timestamp",()=>expect(parseBinanceQuote(JSON.stringify({s:"BTCUSDT",c:"95000"}),BY_SYMBOL)).toBeNull());
