import type { PriceFeed } from "./types";
/** Delayed futures references keep their provider timestamp; never relabel them as live ticks. */
export function createOilReferenceFeed(mapping: Record<string, string>): PriceFeed {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  return {
    async start(onQuote) {
      stopped = false;
      const poll = async () => {
        controller = new AbortController();
        await Promise.all(Object.entries(mapping).map(async ([symbol, provider]) => {
          try {
            const response = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(provider)}?interval=5m&range=1d`, { signal: AbortSignal.any([controller!.signal, AbortSignal.timeout(8000)]), headers: { Accept: "application/json" } });
            if (!response.ok) return;
            const data = await response.json() as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] } };
            const meta = data?.chart?.result?.[0]?.meta;
            const price = meta?.regularMarketPrice, ts = meta?.regularMarketTime;
            if (!stopped && typeof price === "number" && Number.isFinite(price) && price > 0 && typeof ts === "number" && Number.isSafeInteger(ts) && ts > 0 && ts <= Date.now()/1000 + 1) onQuote({ symbol, price, ts });
          } catch { /* Keep the last good reference; market status still applies freshness checks. */ }
        }));
        if (!stopped) timer = setTimeout(poll, 300000);
      };
      void poll();
    },
    async stop() { stopped = true; clearTimeout(timer); controller?.abort(); },
  };
}
