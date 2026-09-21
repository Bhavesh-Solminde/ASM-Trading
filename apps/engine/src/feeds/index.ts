import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";
import { createBinanceFeed } from "./binance";
import { createTwelveDataFeed } from "./twelve-data";

export type { PriceFeed, Quote } from "./types";

// Internal symbol -> provider symbol. Crypto is free over Binance's WebSocket;
// gold has no free exchange feed, so it uses Twelve Data's REST quota sparingly.
const BINANCE: Record<string, string> = { BTCUSD: "btcusdt" };
const TWELVE_DATA: Record<string, string> = { XAUUSD: "XAU/USD" };

// Gold poll rate: 0.4/min ≈ one quote every ~2.5 min ≈ 576 calls/day, inside
// Twelve Data's free 800/day. BTC is on Binance now, so this lone slow symbol
// is the entire external-data cost; the synthetic path covers the gaps.
const GOLD_REQUESTS_PER_MINUTE = 0.4;

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
 * asset: crypto from Binance (free, real-time WS), gold from Twelve Data (free
 * tier, polled slowly). A symbol with no source simply runs synthetic — the
 * registry leaves its anchor null and the GARCH path still ticks — so a missing
 * key or an unmapped asset degrades to a live-looking chart, never a crash.
 */
export function createPriceFeed(symbols: string[]): PriceFeed {
  const feeds: PriceFeed[] = [];

  const crypto = pick(symbols, BINANCE);
  if (Object.keys(crypto).length > 0) {
    feeds.push(createBinanceFeed({ mapping: crypto }));
  }

  const gold = pick(symbols, TWELVE_DATA);
  if (Object.keys(gold).length > 0) {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (apiKey) {
      feeds.push(
        createTwelveDataFeed({ apiKey, mapping: gold, requestsPerMinute: GOLD_REQUESTS_PER_MINUTE }),
      );
    } else {
      logger.info(
        { evt: "engine.feed_selected", feed: "synthetic", reason: "no_api_key", symbols: Object.keys(gold) },
        "TWELVE_DATA_API_KEY not set — gold runs synthetic (no real anchor)",
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
