import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";
import { createBinanceFeed } from "./binance";
import { createLiveRatesFeed } from "./live-rates";
import { createFyersFeed } from "./fyers";

export type { PriceFeed, Quote } from "./types";
export { QuoteBuffer } from "./quote-buffer";

// Internal symbol -> provider symbol. Crypto is free and real-time over
// Binance's WebSocket; forex + gold ride Live-Rates.com's socket.io feed
// (sub-second updates on trial and paid plans); Indian indices come from
// FYERS over the official v3 data WebSocket (see fyers.ts).
// Any symbol absent from all three tables runs fully synthetic.
const BINANCE: Record<string, string> = {
  BTCUSD: "btcusdt",
  BTCUSDT: "btcusdt",
  ETHUSDT: "ethusdt",
  SOLUSDT: "solusdt",
  BNBUSDT: "bnbusdt",
  XRPUSDT: "xrpusdt",
  DOGEUSDT: "dogeusdt",
};
// Live-Rates names forex and metals as a bare 6-letter pair identical to our
// internal symbol, so this mapping is intentionally one-to-one (kept as a
// table so the composite can still pick per asset).
const LIVE_RATES: Record<string, string> = {
  XAUUSD: "XAUUSD",
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCHF: "USDCHF",
  AUDUSD: "AUDUSD",
  USDCAD: "USDCAD",
};
// FYERS Indian-indices mapping. FYERS v3 keys indices as `<EXCH>:<NAME>-INDEX`.
const FYERS: Record<string, string> = {
  NIFTY50: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  NIFTYIT: "NSE:NIFTYIT-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

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
 * Assembles the price feed for the given symbols from the right source per
 * asset: crypto from Binance (free, real-time WS), forex + gold from
 * Live-Rates.com (socket.io v4, ~1 s updates on both trial and paid plans).
 * A symbol with no source simply runs synthetic — the registry leaves its
 * anchor null and the price process still ticks — so a missing key or an
 * unmapped asset (e.g. the India indices) degrades to a live-looking chart,
 * never a crash.
 */
export function createPriceFeed(symbols: string[]): PriceFeed {
  const feeds: PriceFeed[] = [];

  const crypto = pick(symbols, BINANCE);
  if (Object.keys(crypto).length > 0) {
    feeds.push(createBinanceFeed({ mapping: crypto }));
  }

  const liveRates = pick(symbols, LIVE_RATES);
  if (Object.keys(liveRates).length > 0) {
    const key = process.env.LIVE_RATES_KEY ?? "";
    if (key) {
      feeds.push(createLiveRatesFeed({
        key,
        mapping: liveRates,
        ...(process.env.LIVE_RATES_ENDPOINT ? { endpoint: process.env.LIVE_RATES_ENDPOINT } : {}),
      }));
    } else {
      logger.info(
        { evt: "engine.feed_selected", feed: "synthetic", reason: "no_api_key", symbols: Object.keys(liveRates) },
        "LIVE_RATES_KEY not set — forex + gold run synthetic (no real anchor)",
      );
    }
  }

  const fyers = pick(symbols, FYERS);
  if (Object.keys(fyers).length > 0) {
    const appId = process.env.FYERS_APP_ID ?? "";
    if (appId) {
      // The access token is read lazily from the IntegrationToken DB row
      // every token check — we never pass it through env, so a rotated or newly-
      // authorized token reconnects the stream without a redeploy.
      feeds.push(createFyersFeed({ appId, mapping: fyers }));
    } else {
      logger.info(
        { evt: "engine.feed_selected", feed: "synthetic", reason: "no_fyers_app_id", symbols: Object.keys(fyers) },
        "FYERS_APP_ID not set — Indian indices run synthetic (no NSE/BSE anchor)",
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
