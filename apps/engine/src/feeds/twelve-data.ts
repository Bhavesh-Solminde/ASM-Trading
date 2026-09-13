import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

/**
 * Twelve Data REST poller.
 *
 * The free tier allows 8 requests/minute and 800/day. Polling every asset on a
 * timer would exhaust that in minutes, so this polls ONE symbol at a time,
 * round-robin, spaced from the quota. With three assets at 7 requests/minute,
 * each gets a fresh real quote about every 26 seconds — which is the anchor
 * cadence the price engine wants anyway. The synthetic process covers the gap.
 */
export function createTwelveDataFeed(opts: {
  apiKey: string;
  /** Internal symbol -> Twelve Data symbol, e.g. AUDNZD_OTC -> AUD/NZD */
  mapping: Record<string, string>;
  requestsPerMinute: number;
}): PriceFeed {
  const internalSymbols = Object.keys(opts.mapping);
  const spacingMs = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute));

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

/** Chooses a feed from the environment, falling back to replay. */
export function createPriceFeed(symbols: string[]): PriceFeed {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    logger.info(
      { evt: "engine.feed_selected", feed: "replay", reason: "no_api_key" },
      "TWELVE_DATA_API_KEY not set — using the bundled replay dataset",
    );
    // Lazy import avoids a cycle between the two feed modules. `inner` is
    // captured in this closure rather than stashed on `this` — a caller that
    // destructures `{ start, stop }` instead of calling `feed.start()` would
    // silently break a `this`-based version (ESM is strict mode, so a
    // detached method call gets `this === undefined`).
    let inner: PriceFeed | null = null;
    return {
      async start(onQuote) {
        const { createReplayFeed } = await import("./replay");
        inner = createReplayFeed({ symbols, intervalMs: 5000 });
        await inner.start(onQuote);
      },
      async stop() {
        await inner?.stop();
      },
    };
  }

  const mapping: Record<string, string> = {
    USDJPY: "USD/JPY",
    AUDNZD_OTC: "AUD/NZD",
    EURUSD_OTC: "EUR/USD",
  };
  const selected = Object.fromEntries(
    symbols.filter((s) => s in mapping).map((s) => [s, mapping[s]!]),
  );

  return createTwelveDataFeed({ apiKey, mapping: selected, requestsPerMinute: 7 });
}
