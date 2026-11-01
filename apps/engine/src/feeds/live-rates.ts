import { io, type Socket } from "socket.io-client";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

/**
 * Live-Rates.com streaming feed — socket.io v4 with sub-second quote updates
 * for forex, metals and indices. Replaces the Twelve Data REST poller for
 * forex + gold: Twelve Data refreshed every ~15 min per symbol on the free
 * tier (visible chart drift on news); Live-Rates pushes every ~1s per symbol
 * on both the trial and paid plans.
 *
 * Connection lifecycle (from the README):
 *   1. open socket.io to wss.live-rates.com (or a regional endpoint)
 *   2. emit `instruments` with the pairs we want (optional — omit = everything)
 *   3. emit `key` with the subscription key, or literal "trial"
 *   4. listen on `rates` — payload is a JSON string of either a Quote,
 *      `{ info: "..." }`, or `{ error: "..." }`
 */

export interface LiveRatesQuote {
  currency: string;
  bid: number;
  ask: number;
  high: number;
  low: number;
  open: number | "n/a";
  close: number | "n/a";
  timestamp: number;
}

/**
 * Pure parser for one `rates` payload. Returns a Quote if the message is a
 * valid price for a symbol we track, or null for an info/error frame or any
 * malformed payload. Exported for unit tests so the parsing is pinned
 * independently of a live socket.
 *
 * `bySymbol` maps the Live-Rates currency string (e.g. "EURUSD", "XAUUSD")
 * to our internal symbol — they're normally identical, but keeping it
 * mapping-based lets us rename or route the odd symbol later.
 *
 * The quote price is the mid of (bid + ask) / 2, which matches how the
 * engine's shown-price pipeline consumes a single reference price.
 */
export function parseLiveRatesQuote(
  raw: unknown,
  bySymbol: Record<string, string>,
): Quote | null {
  let msg: unknown;
  if (typeof raw === "string") {
    try { msg = JSON.parse(raw); } catch { return null; }
  } else if (raw && typeof raw === "object") {
    msg = raw;
  } else {
    return null;
  }

  if (!msg || typeof msg !== "object") return null;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.error === "string" || typeof obj.info === "string") return null;

  const currency = obj.currency;
  if (typeof currency !== "string") return null;
  const internal = bySymbol[currency.toUpperCase()];
  if (!internal) return null;

  const bid = Number(obj.bid);
  const ask = Number(obj.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
  const price = (bid + ask) / 2;

  const rawTs = Number(obj.timestamp);
  // Live-Rates sends epoch seconds; be defensive about ms (× 1000) too.
  if (!Number.isFinite(rawTs) || rawTs <= 0) return null;
  const ts = rawTs > 1e12 ? Math.floor(rawTs / 1000) : Math.floor(rawTs);

  return { symbol: internal, price, ts };
}

export function createLiveRatesFeed(opts: {
  key: string;
  /** Internal symbol -> Live-Rates currency string. Normally identical. */
  mapping: Record<string, string>;
  /** Override for regional routing (eu-wss / us-wss / as-wss). */
  endpoint?: string;
}): PriceFeed {
  const internalSymbols = Object.keys(opts.mapping);
  // Live-Rates uses the same identifier both directions, so the reverse table
  // is just the mapping values keyed back to internal.
  const bySymbol: Record<string, string> = Object.fromEntries(
    internalSymbols.map((internal) => [opts.mapping[internal]!.toUpperCase(), internal]),
  );
  const subscribe = Object.values(opts.mapping);
  const endpoint = opts.endpoint ?? "https://wss.live-rates.com";

  let socket: Socket | null = null;

  return {
    async start(onQuote: (quote: Quote) => void) {
      socket = io(endpoint, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
      });

      socket.on("connect", () => {
        logger.info(
          { evt: "engine.feed_connected", feed: "live-rates", symbols: internalSymbols, endpoint },
          "live-rates feed connected",
        );
        // instruments first, then key — the server starts streaming on key.
        if (subscribe.length > 0) socket!.emit("instruments", subscribe);
        socket!.emit("key", opts.key);
      });

      socket.on("rates", (raw: unknown) => {
        const quote = parseLiveRatesQuote(raw, bySymbol);
        if (quote) onQuote(quote);
      });

      socket.on("disconnect", (reason) => {
        logger.warn(
          { evt: "engine.feed_gap", feed: "live-rates", reason },
          "live-rates socket disconnected — will reconnect",
        );
      });

      socket.on("connect_error", (err) => {
        logger.warn(
          { evt: "engine.feed_gap", feed: "live-rates", reason: err.message },
          "live-rates connect error — will retry",
        );
      });
    },

    async stop() {
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
        logger.info({ evt: "engine.feed_stopped", feed: "live-rates" }, "live-rates feed stopped");
      }
    },
  };
}
