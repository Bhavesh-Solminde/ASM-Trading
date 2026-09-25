"use client";

import { TIMEFRAMES } from "@asm/contracts";
import { usePlatform } from "@/components/shell/PlatformProvider";

/** Compact candle-timeframe selector shown on the chart. */
export function TimeframeTabs({ className = "" }: { className?: string }) {
  const { timeframe, selectTimeframe } = usePlatform();
  return (
    <div
      role="tablist"
      aria-label="Candle timeframe"
      className={`flex gap-0.5 rounded-[3px] border border-rule bg-ground/70 p-0.5 backdrop-blur ${className}`}
    >
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={tf === timeframe}
          onClick={() => selectTimeframe(tf)}
          className={`rounded-[2px] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${
            tf === timeframe ? "bg-up text-up-ink" : "text-ink-3 hover:text-ink"
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
