import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

/**
 * Twelve Data REST poller.
 *
 * The free tier allows 8 requests/minute and 800/day. This polls ONE symbol at
 * a time, round-robin, spaced from `requestsPerMinute` (fractional is allowed,
 * for slow polling). Crypto is served by the free Binance WebSocket feed, so in
 * practice this handles only gold at a low rate that stays inside the free tier;
 * the synthetic price path covers the long gaps between quotes.
 *
 * Note: XAU/USD (gold) has market hours and returns a stale quote on weekends —
 * the synthetic path keeps the candle alive meanwhile.
 */
export function createTwelveDataFeed(opts: {
  apiKey: string;
  /** Internal symbol -> Twelve Data symbol, e.g. BTCUSD -> BTC/USD */
  mapping: Record<string, string>;
  requestsPerMinute: number;
}): PriceFeed {
  const internalSymbols = Object.keys(opts.mapping);
  // Fractional rates are allowed (e.g. 0.4/min ≈ one call every 2.5 min); the
  // 0.1 floor just caps the spacing at 10 minutes so a bad value can't idle it.
  const spacingMs = Math.ceil(60_000 / Math.max(0.1, opts.requestsPerMinute));

  let timer: NodeJS.Timeout | null = null;
  let index = 0;
  let consecutiveFailures = 0;

  return {
    async start(onQuote: (quote: Quote) => void) {
      logger.info(
        {
          evt: "engine.feed_connected",
          feed: "twelve-data",
          symbols: internalSymbols,
          spacingMs,
        },
        "twelve data feed started",
      );

      timer = setInterval(async () => {
        const internal = internalSymbols[index % internalSymbols.length]!;
        index++;
        const remote = opts.mapping[internal]!;

        try {
          const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(remote)}&apikey=${encodeURIComponent(opts.apiKey)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const body = (await res.json()) as { price?: string; code?: number };
          if (body.code === 429) throw new Error("quota exceeded");

          const price = Number(body.price);
          if (!Number.isFinite(price) || price <= 0) {
            throw new Error(`unusable price payload: ${JSON.stringify(body)}`);
          }

          consecutiveFailures = 0;
          onQuote({ symbol: internal, price, ts: Math.floor(Date.now() / 1000) });
        } catch (err) {
          consecutiveFailures++;
          logger.warn(
            {
              evt: "engine.feed_gap",
              feed: "twelve-data",
              symbol: internal,
              consecutiveFailures,
              reason: err instanceof Error ? err.message : "unknown",
            },
            "quote fetch failed",
          );
        }
      }, spacingMs);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info(
        { evt: "engine.feed_stopped", feed: "twelve-data" },
        "twelve data feed stopped",
      );
    },
  };
}
