import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(here, "../../data/seed-quotes.json");

type Dataset = Record<string, number[]>;

/**
 * Offline feed. Cycles a bundled dataset so the engine runs with no API key and
 * no network. Also the fallback when the live feed's quota is exhausted — a
 * dead chart is a worse failure than a replayed one.
 */
export function createReplayFeed(opts: {
  symbols: string[];
  intervalMs: number;
}): PriceFeed {
  let timer: NodeJS.Timeout | null = null;
  let cursor = 0;

  return {
    async start(onQuote: (quote: Quote) => void) {
      const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Dataset;

      for (const symbol of opts.symbols) {
        if (!dataset[symbol]) {
          throw new Error(
            `Replay dataset has no series for symbol "${symbol}". Add it to data/seed-quotes.json.`,
          );
        }
      }

      logger.info(
        { evt: "engine.feed_connected", feed: "replay", symbols: opts.symbols },
        "replay feed started",
      );

      timer = setInterval(() => {
        const ts = Math.floor(Date.now() / 1000);
        for (const symbol of opts.symbols) {
          const series = dataset[symbol]!;
          onQuote({ symbol, price: series[cursor % series.length]!, ts });
        }
        cursor++;
      }, opts.intervalMs);
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info({ evt: "engine.feed_stopped", feed: "replay" }, "replay feed stopped");
    },
  };
}
