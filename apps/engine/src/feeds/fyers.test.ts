import { describe, expect, it, vi, afterEach } from "vitest";
import { parseFyersQuoteRow, createFyersFeed } from "./fyers";
import type { Quote } from "./types";

const BY_SYMBOL = {
  "NSE:NIFTY50-INDEX": "NIFTY50",
  "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
  "NSE:FINNIFTY-INDEX": "FINNIFTY",
  "NSE:NIFTYIT-INDEX": "NIFTYIT",
  "BSE:SENSEX-INDEX": "SENSEX",
};

describe("parseFyersQuoteRow — /data/quotes response row", () => {
  it("maps NSE:NIFTY50-INDEX → NIFTY50 and reads v.lp as the mid price", () => {
    const row = { n: "NSE:NIFTY50-INDEX", s: "ok", v: { lp: 25101.3, tt: 1_729_800_000 } };
    expect(parseFyersQuoteRow(row, BY_SYMBOL)).toEqual({
      symbol: "NIFTY50", price: 25101.3, ts: 1_729_800_000,
    });
  });

  it("accepts v.ltp as an alias for v.lp (seen in some response variants)", () => {
    const row = { n: "BSE:SENSEX-INDEX", v: { ltp: 82_000.1, tt: 1_729_800_000 } };
    const quote = parseFyersQuoteRow(row, BY_SYMBOL);
    expect(quote?.symbol).toBe("SENSEX");
    expect(quote?.price).toBeCloseTo(82_000.1, 2);
  });

  it("falls back to `now` when the tick timestamp is missing or zero", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = { n: "NSE:NIFTY50-INDEX", v: { lp: 25100 } };
    const q = parseFyersQuoteRow(row, BY_SYMBOL)!;
    expect(q.ts).toBeGreaterThanOrEqual(before);
  });

  it("returns null when the symbol is not in our mapping", () => {
    const row = { n: "NSE:RELIANCE-EQ", v: { lp: 1200, tt: 1_729_800_000 } };
    expect(parseFyersQuoteRow(row, BY_SYMBOL)).toBeNull();
  });

  it("returns null when `v` is absent, zero, or non-numeric", () => {
    expect(parseFyersQuoteRow({ n: "NSE:NIFTY50-INDEX" }, BY_SYMBOL)).toBeNull();
    expect(parseFyersQuoteRow({ n: "NSE:NIFTY50-INDEX", v: { lp: 0, tt: 1 } }, BY_SYMBOL)).toBeNull();
    expect(parseFyersQuoteRow({ n: "NSE:NIFTY50-INDEX", v: { lp: "abc", tt: 1 } }, BY_SYMBOL)).toBeNull();
  });

  it("returns null on an entirely wrong-shape input (defensive against FYERS tweaks)", () => {
    expect(parseFyersQuoteRow(null, BY_SYMBOL)).toBeNull();
    expect(parseFyersQuoteRow("string", BY_SYMBOL)).toBeNull();
    expect(parseFyersQuoteRow(42, BY_SYMBOL)).toBeNull();
    expect(parseFyersQuoteRow({ n: 42 }, BY_SYMBOL)).toBeNull();
  });
});

describe("createFyersFeed — REST poller", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("no-ops silently when the stored token is missing (admin hasn't authorized yet)", async () => {
    const feed = createFyersFeed({
      appId: "FQEO03EUPG-100",
      mapping: { NIFTY50: "NSE:NIFTY50-INDEX" },
      getToken: async () => null,
      fetchImpl: vi.fn(),
    });
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await feed.stop();
    expect(quotes).toHaveLength(0);
  });

  it("POSTs symbols with Authorization: APP_ID:TOKEN and emits each parsed row", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      s: "ok",
      d: [
        { n: "NSE:NIFTY50-INDEX", s: "ok", v: { lp: 25100.5, tt: 1_729_800_000 } },
        { n: "BSE:SENSEX-INDEX",  s: "ok", v: { lp: 82010.2, tt: 1_729_800_000 } },
      ],
    }), { status: 200 }));

    const feed = createFyersFeed({
      appId: "FQEO03EUPG-100",
      mapping: { NIFTY50: "NSE:NIFTY50-INDEX", SENSEX: "BSE:SENSEX-INDEX" },
      pollMs: 1_000_000, // long interval — we only care about the immediate first tick
      getToken: async () => "AT_XYZ",
      fetchImpl: fetchMock,
    });

    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    // First tick fires inside .start() as `void tick(onQuote)`. Flush its microtasks.
    await new Promise((r) => setImmediate(r));
    await feed.stop();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-t1.fyers.in/data/quotes");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("FQEO03EUPG-100:AT_XYZ");
    expect(JSON.parse(init.body as string)).toEqual({
      symbols: ["NSE:NIFTY50-INDEX", "BSE:SENSEX-INDEX"],
    });

    expect(quotes).toHaveLength(2);
    expect(quotes.map((q) => q.symbol).sort()).toEqual(["NIFTY50", "SENSEX"]);
  });

  it("swallows a FYERS error response — the synthetic path keeps the chart alive", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ s: "error", message: "token expired" }),
      { status: 200 },
    ));
    const feed = createFyersFeed({
      appId: "FQEO03EUPG-100",
      mapping: { NIFTY50: "NSE:NIFTY50-INDEX" },
      pollMs: 1_000_000,
      getToken: async () => "AT_XYZ",
      fetchImpl: fetchMock,
    });
    const quotes: Quote[] = [];
    await feed.start((q) => quotes.push(q));
    await new Promise((r) => setImmediate(r));
    await feed.stop();
    expect(quotes).toHaveLength(0); // nothing emitted, but process still alive
  });
});
