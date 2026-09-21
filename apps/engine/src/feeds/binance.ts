import WebSocket from "ws";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

const BINANCE_WS = "wss://stream.binance.com:9443/stream";
const MAX_BACKOFF_MS = 30_000;

/**
 * Parses one Binance `miniTicker` frame into a Quote, or null if it is not a
 * usable price for a symbol we track. Pure, so the parsing is unit-tested
 * rather than eyeballed on a live socket.
 *
 * `bySymbol` maps the Binance symbol (uppercase, e.g. BTCUSDT) to our internal
 * symbol (e.g. BTCUSD). Combined streams wrap the payload as `{ stream, data }`;
 * single streams send the payload directly — both are handled.
 */
export function parseBinanceQuote(raw: string, bySymbol: Record<string, string>): Quote | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }

  const payload =
    msg && typeof msg === "object" && "data" in msg ? (msg as { data: unknown }).data : msg;
  if (!payload || typeof payload !== "object") return null;

  const { s, c } = payload as { s?: unknown; c?: unknown };
  if (typeof s !== "string") return null;

  const internal = bySymbol[s.toUpperCase()];
  if (!internal) return null;

  const price = Number(c);
  if (!Number.isFinite(price) || price <= 0) return null;

  return { symbol: internal, price, ts: Math.floor(Date.now() / 1000) };
}

/**
 * Binance public WebSocket feed for crypto.
 *
 * Exchange price data is free, keyless, and pushed in real time over one
 * connection — no polling and no per-request quota, unlike the REST feeds. On a
 * drop (Binance also force-closes every 24h) it reconnects with backoff; the
 * synthetic price path covers the gap meanwhile.
 *
 * Binance quotes crypto against USDT (a ~$1 stablecoin), so BTCUSDT stands in
 * for BTC/USD — the peg deviation is immaterial next to the synthetic process.
 *
 * Note: Binance is geo-restricted in some regions (e.g. the US uses a separate
 * binance.us host). If the engine is deployed where stream.binance.com is
 * blocked, point this at another exchange's public feed.
 */
export function createBinanceFeed(opts: {
  /** Internal symbol -> Binance stream symbol (lowercase), e.g. BTCUSD -> btcusdt */
  mapping: Record<string, string>;
}): PriceFeed {
  const entries = Object.entries(opts.mapping);
  const bySymbol = Object.fromEntries(entries.map(([internal, b]) => [b.toUpperCase(), internal]));
  const url = `${BINANCE_WS}?streams=${entries.map(([, b]) => `${b}@miniTicker`).join("/")}`;

  let socket: WebSocket | null = null;
  let closedByUs = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let onQuoteRef: ((quote: Quote) => void) | null = null;

  const scheduleReconnect = () => {
    attempt += 1;
    reconnectTimer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt));
  };

  function connect(): void {
    const ws = new WebSocket(url);
    socket = ws;

    ws.on("open", () => {
      attempt = 0;
      logger.info(
        { evt: "engine.feed_connected", feed: "binance", symbols: Object.values(bySymbol) },
        "binance feed connected",
      );
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      const quote = parseBinanceQuote(raw.toString(), bySymbol);
      if (quote) onQuoteRef?.(quote);
    });

    ws.on("close", () => {
      if (!closedByUs) scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      logger.warn(
        { evt: "engine.feed_gap", feed: "binance", reason: err.message },
        "binance socket error",
      );
      // A "close" follows and drives the reconnect; make sure it fires.
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    });
  }

  return {
    async start(onQuote: (quote: Quote) => void) {
      onQuoteRef = onQuote;
      closedByUs = false;
      connect();
    },

    async stop() {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
      logger.info({ evt: "engine.feed_stopped", feed: "binance" }, "binance feed stopped");
    },
  };
}
