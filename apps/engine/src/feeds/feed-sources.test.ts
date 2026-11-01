// Step 4 of docs/cfd-revenue-test-handoff.md — all 3 feed sources deliver.
//
// Binance (crypto WS), Live-Rates.com (forex + gold socket.io), and the
// synthetic fallback. Live sockets are faked here; we verify the assembly,
// routing and payload parsing, not Binance / Live-Rates availability.
import { describe, expect, it, afterEach } from "vitest";
import { parseBinanceQuote } from "./binance";
import { parseLiveRatesQuote } from "./live-rates";
import { createPriceFeed } from "./index";
import type { Quote } from "./types";

describe("Binance — parseBinanceQuote (crypto feed)", () => {
  const BY_SYMBOL = { BTCUSDT: "BTCUSD", ETHUSDT: "ETHUSDT" };

  it("routes BTCUSDT → BTCUSD and keeps ETHUSDT as itself", () => {
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "BTCUSDT", c: "95000" } }), BY_SYMBOL)?.symbol).toBe("BTCUSD");
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "ETHUSDT", c: "3200" } }), BY_SYMBOL)?.symbol).toBe("ETHUSDT");
  });

  it("skips untracked symbols so a mapping miss cannot wedge the engine", () => {
    expect(parseBinanceQuote(JSON.stringify({ data: { s: "DOGEUSDT", c: "0.07" } }), BY_SYMBOL)).toBeNull();
  });
});

describe("Live-Rates — parseLiveRatesQuote (forex + gold socket.io)", () => {
  const BY_SYMBOL = { EURUSD: "EURUSD", XAUUSD: "XAUUSD" };

  it("parses a JSON-stringified Quote into mid-price + epoch-sec timestamp", () => {
    const payload = JSON.stringify({
      currency: "EURUSD",
      bid: 1.0821, ask: 1.0823, high: 1.0830, low: 1.0815,
      open: 1.0820, close: "n/a", timestamp: 1_729_800_000,
    });
    const q = parseLiveRatesQuote(payload, BY_SYMBOL);
    expect(q?.symbol).toBe("EURUSD");
    expect(q?.price).toBeCloseTo(1.0822, 6); // mid of 1.0821 and 1.0823
    expect(q?.ts).toBe(1_729_800_000);
  });

  it("accepts an already-parsed object (some socket.io middlewares deliver that)", () => {
    const q = parseLiveRatesQuote(
      { currency: "XAUUSD", bid: 2650.1, ask: 2650.5, high: 2652, low: 2649, open: 2650, close: "n/a", timestamp: 1_729_800_000 },
      BY_SYMBOL,
    );
    expect(q?.symbol).toBe("XAUUSD");
    expect(q?.price).toBeCloseTo(2650.3, 4);
  });

  it("converts a millisecond timestamp down to epoch seconds", () => {
    const ms = 1_729_800_000_123;
    const q = parseLiveRatesQuote(
      { currency: "EURUSD", bid: 1.08, ask: 1.08, high: 1.08, low: 1.08, open: 1.08, close: 1.08, timestamp: ms },
      BY_SYMBOL,
    );
    expect(q?.ts).toBe(1_729_800_000);
  });

  it("returns null on an `info` frame (connection/subscribe acknowledgements)", () => {
    expect(parseLiveRatesQuote(JSON.stringify({ info: "connected" }), BY_SYMBOL)).toBeNull();
  });

  it("returns null on an `error` frame (bad key, rate limit)", () => {
    expect(parseLiveRatesQuote(JSON.stringify({ error: "invalid key" }), BY_SYMBOL)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseLiveRatesQuote("not json", BY_SYMBOL)).toBeNull();
  });

  it("skips untracked symbols so a mapping miss cannot wedge the engine", () => {
    expect(parseLiveRatesQuote(JSON.stringify({ currency: "USDTRY", bid: 34, ask: 34.1, timestamp: 0 }), BY_SYMBOL)).toBeNull();
  });

  it("returns null when the bid or ask is missing, zero or non-numeric", () => {
    expect(parseLiveRatesQuote(JSON.stringify({ currency: "EURUSD", bid: 0, ask: 1.08, timestamp: 0 }), BY_SYMBOL)).toBeNull();
    expect(parseLiveRatesQuote(JSON.stringify({ currency: "EURUSD", bid: "x", ask: 1.08, timestamp: 0 }), BY_SYMBOL)).toBeNull();
    expect(parseLiveRatesQuote(JSON.stringify({ currency: "EURUSD", bid: 1.08, timestamp: 0 }), BY_SYMBOL)).toBeNull();
  });
});

describe("Composite feed assembly — Binance + Live-Rates + Synthetic", () => {
  const prevKey = process.env.LIVE_RATES_KEY;
  afterEach(() => {
    if (prevKey == null) delete process.env.LIVE_RATES_KEY;
    else process.env.LIVE_RATES_KEY = prevKey;
  });

  it("returns a working no-op feed for a wholly-synthetic set of symbols (e.g. NIFTY50)", async () => {
    delete process.env.LIVE_RATES_KEY;
    const feed = createPriceFeed(["NIFTY50"]);
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await feed.stop();
    expect(quotes).toHaveLength(0);
  });

  it("without LIVE_RATES_KEY, forex symbols fall back to synthetic silently", async () => {
    delete process.env.LIVE_RATES_KEY;
    const feed = createPriceFeed(["EURUSD", "XAUUSD"]);
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await feed.stop();
    expect(quotes).toHaveLength(0);
  });
});
