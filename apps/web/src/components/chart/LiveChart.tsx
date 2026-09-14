"use client";

import { useEngineSocket } from "./useEngineSocket";
import { PriceChart } from "./PriceChart";

export function LiveChart({
  symbol,
  displayName,
  precision,
}: {
  symbol: string;
  displayName: string;
  precision: number;
}) {
  const { status, chart } = useEngineSocket({ symbol, timeframe: "1m" });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold">{displayName}</span>
          {chart.payoutPct !== null ? (
            <span className="text-xs font-semibold text-[var(--color-up)]">{chart.payoutPct}%</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {chart.lastPrice !== null ? (
            <span className="text-sm font-semibold tabular-nums">{chart.lastPrice.toFixed(precision)}</span>
          ) : null}
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: status === "open" ? "var(--color-up)" : "var(--color-ink-2)" }}
          >
            {status === "open" ? "Live" : status}
          </span>
        </div>
      </div>
      {status === "unauthorised" ? (
        <p className="text-xs text-[var(--color-down)]">Your session has ended. Log in again.</p>
      ) : null}
      <PriceChart candles={chart.candles} forming={chart.forming} precision={precision} />
    </div>
  );
}
