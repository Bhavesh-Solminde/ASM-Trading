import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

/**
 * FYERS quotes feed for Indian indices (NIFTY50, BANKNIFTY, FINNIFTY,
 * NIFTYIT, SENSEX). Uses the REST `/data/quotes` endpoint (POST, batched)
 * on a 2-second cadence so all five indices refresh together with ~0.5
 * requests/second total — comfortably inside FYERS's documented ~10 req/s
 * ceiling.
 *
 * We intentionally use REST polling in this first PR rather than the v3
 * binary WebSocket (`wss://socket.fyers.in/hsm/v1-5/prod`). The binary
 * protocol requires:
 *   - a separate HSM-token round-trip (`POST /data/symbol-token`),
 *   - loading a static `map.json` for exchange-segment decoding, and
 *   - channel-level framing — see the official Go SDK at
 *     github.com/FyersDev/fyers-go-sdk/websocket/protocol.go.
 * Porting that to Node is a bounded but non-trivial job, and it is only
 * testable against a live token during NSE market hours. REST polling at
 * 2 s/batch is already a dramatic upgrade from the fully-synthetic Indian
 * indices chart; a WS upgrade will land in a follow-up PR with its own
 * market-hours validation session.
 *
 * The access token lives in the IntegrationToken DB row keyed by
 * "fyers" — it is NEVER read from env (so a rotated token doesn't require
 * a redeploy) and NEVER logged. If the token is missing or expired, the
 * feed logs once and no-ops; the engine's synthetic path keeps the chart
 * alive meanwhile.
 */

const FYERS_QUOTES_URL = "https://api-t1.fyers.in/data/quotes";
const DEFAULT_POLL_MS = 2_000;

export interface FyersQuoteRow {
  n?: string;       // symbol
  s?: string;       // status flag
  v?: {
    lp?: number;    // last traded price (indices)
    ltp?: number;   // alt name used in some payloads
    tt?: number;    // tick timestamp (epoch seconds)
  };
}

/**
 * Pure parser for one `/data/quotes` response row. Returns a Quote or null
 * for a missing / malformed row. Pulled out so the quote-shape handling is
 * unit-tested independent of a live FYERS session.
 */
export function parseFyersQuoteRow(
  row: unknown,
  bySymbol: Record<string, string>,
): Quote | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as FyersQuoteRow;
  const sym = typeof obj.n === "string" ? obj.n : null;
  if (!sym) return null;
  const internal = bySymbol[sym];
  if (!internal) return null;

  const v = obj.v;
  if (!v || typeof v !== "object") return null;
  const priceRaw = v.lp ?? v.ltp;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) return null;

  const ttRaw = Number(v.tt);
  const ts = Number.isFinite(ttRaw) && ttRaw > 0 ? Math.floor(ttRaw) : Math.floor(Date.now() / 1000);
  return { symbol: internal, price, ts };
}

export interface FyersFeedOptions {
  appId: string;
  /** Internal symbol -> FYERS symbol, e.g. NIFTY50 -> NSE:NIFTY50-INDEX. */
  mapping: Record<string, string>;
  /** Poll cadence in milliseconds. Defaults to 2000 (5 indices @ 0.5 req/s total). */
  pollMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  /** For tests. */
  getToken?: () => Promise<string | null>;
}

/**
 * Reads the live FYERS access token from the IntegrationToken DB row.
 * Returns null when no token exists OR the stored token has already expired —
 * the feed treats both as "integration not connected" and runs synthetic.
 */
async function readStoredToken(): Promise<string | null> {
  try {
    const row = await prisma.integrationToken.findUnique({ where: { provider: "fyers" } });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row.accessToken;
  } catch (err) {
    logger.warn({ evt: "fyers.token_read_failed", err: String(err) }, "could not read FYERS token row");
    return null;
  }
}

export function createFyersFeed(opts: FyersFeedOptions): PriceFeed {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? readStoredToken;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const internalSymbols = Object.keys(opts.mapping);
  const fyersSymbols = Object.values(opts.mapping);
  const bySymbol: Record<string, string> = Object.fromEntries(
    internalSymbols.map((internal) => [opts.mapping[internal]!, internal]),
  );

  let timer: NodeJS.Timeout | null = null;
  let inflight = false;
  let consecutiveFailures = 0;

  async function tick(onQuote: (q: Quote) => void): Promise<void> {
    if (inflight) return; // skip overlapping ticks
    inflight = true;
    try {
      const token = await getToken();
      if (!token) {
        // No token — nothing to do. Logged once at startup, then silent.
        return;
      }

      const resp = await fetchImpl(FYERS_QUOTES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${opts.appId}:${token}`,
        },
        body: JSON.stringify({ symbols: fyersSymbols }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { s?: string; d?: unknown[]; message?: string };
      if (body.s !== "ok" || !Array.isArray(body.d)) {
        throw new Error(`FYERS error: ${body.s ?? "unknown"}${body.message ? ": " + body.message : ""}`);
      }

      for (const row of body.d) {
        const quote = parseFyersQuoteRow(row, bySymbol);
        if (quote) onQuote(quote);
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      logger.warn(
        {
          evt: "engine.feed_gap",
          feed: "fyers",
          consecutiveFailures,
          reason: err instanceof Error ? err.message : "unknown",
        },
        "FYERS quote fetch failed",
      );
    } finally {
      inflight = false;
    }
  }

  return {
    async start(onQuote: (quote: Quote) => void) {
      // One-time boot check: if we have no token at all, log a visible info
      // event so operators know they still need to run /authorize.
      const token = await getToken();
      if (!token) {
        logger.info(
          { evt: "engine.feed_selected", feed: "synthetic", reason: "no_fyers_token", symbols: internalSymbols },
          "FYERS token missing/expired — Indian indices run synthetic until admin authorizes",
        );
        return;
      }
      logger.info(
        { evt: "engine.feed_connected", feed: "fyers", symbols: internalSymbols, pollMs },
        "FYERS quotes feed started",
      );
      timer = setInterval(() => { void tick(onQuote); }, pollMs);
      timer.unref?.();
      // Fire one tick immediately so the first quote lands before the next interval.
      void tick(onQuote);
    },

    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info({ evt: "engine.feed_stopped", feed: "fyers" }, "FYERS feed stopped");
      }
    },
  };
}
