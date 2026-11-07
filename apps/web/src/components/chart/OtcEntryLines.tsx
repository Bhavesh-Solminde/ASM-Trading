"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { TIMEFRAME_SEC, type TradeView } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";

/** Entry lines start at the accepted trade's candle, including late responses. */
export function OtcEntryLines({
  trades, chartRef, seriesRef, market, chartVersion,
}: {
  trades: TradeView[];
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<any> | null>;
  market: MarketStore;
  chartVersion: number;
}) {
  const rows = useRef(new Map<string, HTMLDivElement>());
  const positions = useMemo(() => trades.filter(trade => trade.mode === "OTC_FIXED"), [trades]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !positions.length) return;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const state = market.getSnapshot().chart;
      const series = seriesRef.current;
      if (!series) return;
      const timeScale = chart.timeScale();
      const width = timeScale.width();
      const height = chart.paneSize().height;
      const first = state.candles[0] ?? state.forming;
      const period = TIMEFRAME_SEC[state.timeframe];

      for (const trade of positions) {
        const row = rows.current.get(trade.id);
        if (!row) continue;
        // Bucket down to the candle OPEN, never round to a nearby candle.
        const candleTime = Math.floor(trade.entryTs / period) * period;
        const x = first && candleTime < first.openTs
          ? 0
          : timeScale.timeToCoordinate(candleTime as UTCTimestamp);
        const y = series.priceToCoordinate(trade.entryPrice);
        row.hidden = trade.symbol !== state.symbol || x === null || y === null || x > width || y < 0 || y > height;
        if (x !== null && y !== null) {
          const left = Math.max(0, x);
          row.style.transform = `translate(${left}px, ${y}px)`;
          row.style.width = `${Math.max(0, width - left)}px`;
          row.firstElementChild?.toggleAttribute("hidden", x < 0 || Boolean(first && candleTime < first.openTs));
        }
      }
    };

    // Wait for lightweight-charts to apply its pending data/viewport changes.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(draw); });
    };
    const unsubscribe = market.subscribe(schedule);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.timeScale().subscribeSizeChange(schedule);
    schedule();
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
      chart.timeScale().unsubscribeSizeChange(schedule);
    };
  }, [positions, chartRef, seriesRef, market, chartVersion]);

  return (
    <div aria-label="Trade entry lines" className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
      {positions.map(trade => (
        <div
          key={trade.id}
          ref={row => { if (row) rows.current.set(trade.id, row); else rows.current.delete(trade.id); }}
          hidden
          aria-label={`${trade.direction === "UP" ? "Buy" : "Sell"} entry`}
          className="absolute left-0 top-0 border-t-2"
          style={{ color: trade.direction === "UP" ? "#089981" : "#f23645", borderColor: "currentColor" }}
        >
          <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-current" />
        </div>
      ))}
    </div>
  );
}
