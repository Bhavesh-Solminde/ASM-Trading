"use client";

import { useEffect, useState } from "react";

export type CfdMarketStatus = "open" | "closed" | "unavailable";

/** One status source for the chart's live overlays and the trade ticket. */
export function useCfdMarketStatus(symbol: string, enabled: boolean): CfdMarketStatus {
  const [market, setMarket] = useState<{ symbol: string; status: CfdMarketStatus } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const res = await fetch(`/api/cfd/market-status?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await res.json();
        const status = res.ok && (data.status === "open" || data.status === "closed") ? data.status : "unavailable";
        if (!controller.signal.aborted) setMarket({ symbol, status });
      } catch {
        if (!controller.signal.aborted) setMarket({ symbol, status: "unavailable" });
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [symbol, enabled]);
  return enabled && market?.symbol === symbol ? market.status : "unavailable";
}
