// Step 4 of docs/cfd-revenue-test-handoff.md — all 3 feed sources deliver.
//
// Binance (crypto WS), Twelve Data (REST poller), and the synthetic fallback.
// Live sockets and real HTTP are faked here; we verify the assembly, routing
// and payload parsing, not Binance / Twelve Data availability.
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseBinanceQuote } from "./binance";
import { createTwelveDataFeed } from "./twelve-data";
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

describe("Twelve Data — createTwelveDataFeed (forex + gold REST poller)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers quotes mapped from Twelve Data symbols to our internal ones", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      // One mocked endpoint for each internal symbol.
      const price = url.includes("XAU%2FUSD") ? "2651.42" : "1.0831";
      return new Response(JSON.stringify({ price }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const feed = createTwelveDataFeed({
      apiKey: "KEYTEST",
      mapping: { XAUUSD: "XAU/USD", EURUSD: "EUR/USD" },
      requestsPerMinute: 60, // → 1s spacing, kind to fake timers
    });

    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));

    // Round-robin: first tick XAUUSD, second EURUSD.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await feed.stop();

    const symbols = quotes.map((q) => q.symbol);
    expect(symbols).toContain("XAUUSD");
    expect(symbols).toContain("EURUSD");
    const xau = quotes.find((q) => q.symbol === "XAUUSD");
    expect(xau?.price).toBeCloseTo(2651.42, 2);
  });

  it("swallows a 429 quota response — the synthetic path keeps the market alive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: 429, message: "quota" }), { status: 200 })),
    );
    const feed = createTwelveDataFeed({ apiKey: "k", mapping: { EURUSD: "EUR/USD" }, requestsPerMinute: 60 });
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await vi.advanceTimersByTimeAsync(2_000);
    await feed.stop();
    expect(quotes).toHaveLength(0);
  });
});

describe("Composite feed assembly — Binance + Twelve Data + Synthetic", () => {
  const prevKey = process.env.TWELVE_DATA_API_KEY;
  afterEach(() => {
    if (prevKey == null) delete process.env.TWELVE_DATA_API_KEY;
    else process.env.TWELVE_DATA_API_KEY = prevKey;
  });

  it("returns a working no-op feed for a wholly-synthetic set of symbols (e.g. NIFTY50)", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const feed = createPriceFeed(["NIFTY50"]);
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await feed.stop();
    // No external source → no quotes delivered; the engine's synthetic path
    // produces prices for these symbols downstream, which Step 5 exercises.
    expect(quotes).toHaveLength(0);
  });

  it("without TWELVE_DATA_API_KEY, forex symbols fall back to synthetic silently", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const feed = createPriceFeed(["EURUSD", "XAUUSD"]);
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await feed.stop();
    expect(quotes).toHaveLength(0);
  });
});
