import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";
import { createBinanceFeed } from "./binance";
import { createTwelveDataFeed } from "./twelve-data";

export type { PriceFeed, Quote } from "./types";

// Internal symbol -> provider symbol. Crypto is free and real-time over
// Binance's WebSocket; forex + gold have no free exchange feed, so they share
// Twelve Data's REST quota sparingly. Any symbol absent from both tables (e.g.
// the India indices) runs fully synthetic.
const BINANCE: Record<string, string> = {
  BTCUSD: "btcusdt",
  BTCUSDT: "btcusdt",
  ETHUSDT: "ethusdt",
  SOLUSDT: "solusdt",
  BNBUSDT: "bnbusdt",
  XRPUSDT: "xrpusdt",
  DOGEUSDT: "dogeusdt",
};
const TWELVE_DATA: Record<string, string> = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCHF: "USD/CHF",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD",
};

// Twelve Data poll budget shared round-robin across ALL its symbols (gold +
// forex). The free tier is 8/min and 800/day; 0.45/min ≈ 648 calls/day stays
// inside it with headroom. With ~7 symbols each refreshes roughly every 15 min,
// and the synthetic path covers the long gaps between quotes.
const TWELVE_DATA_REQUESTS_PER_MINUTE = 0.45;

function pick(symbols: string[], table: Record<string, string>): Record<string, string> {
  return Object.fromEntries(symbols.filter((s) => s in table).map((s) => [s, table[s]!]));
}

/** Runs several feeds as one, merging their quotes into a single callback. */
function compositeFeed(feeds: PriceFeed[]): PriceFeed {
  return {
    async start(onQuote: (quote: Quote) => void) {
      await Promise.all(feeds.map((feed) => feed.start(onQuote)));
    },
    async stop() {
      await Promise.all(feeds.map((feed) => feed.stop()));
    },
  };
}

/**
 * Assembles the price feed for the given symbols from the cheapest source per
 * asset: crypto from Binance (free, real-time WS), forex + gold from Twelve Data
 * (free tier, polled slowly and shared). A symbol with no source simply runs
 * synthetic — the registry leaves its anchor null and the GARCH path still
 * ticks — so a missing key or an unmapped asset (e.g. the India indices)
 * degrades to a live-looking chart, never a crash.
 */
export function createPriceFeed(symbols: string[]): PriceFeed {
  const feeds: PriceFeed[] = [];

  const crypto = pick(symbols, BINANCE);
  if (Object.keys(crypto).length > 0) {
    feeds.push(createBinanceFeed({ mapping: crypto }));
  }

  const twelveData = pick(symbols, TWELVE_DATA);
  if (Object.keys(twelveData).length > 0) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (apiKey) {
      feeds.push(
        createTwelveDataFeed({
          apiKey,
          mapping: twelveData,
          requestsPerMinute: TWELVE_DATA_REQUESTS_PER_MINUTE,
        }),
      );
    } else {
      logger.info(
        { evt: "engine.feed_selected", feed: "synthetic", reason: "no_api_key", symbols: Object.keys(twelveData) },
        "TWELVE_DATA_API_KEY not set — forex + gold run synthetic (no real anchor)",
      );
    }
  }

  if (feeds.length === 0) {
    logger.info(
      { evt: "engine.feed_selected", feed: "synthetic", reason: "no_external_source" },
      "no external price source — running fully synthetic",
    );
    return { async start() {}, async stop() {} };
  }

  return feeds.length === 1 ? feeds[0]! : compositeFeed(feeds);
}
