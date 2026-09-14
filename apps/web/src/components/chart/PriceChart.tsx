"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleDto } from "@asm/contracts";

function toBar(c: CandleDto): CandlestickData {
  return { time: c.openTs as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c };
}

export function PriceChart({
  candles,
  forming,
  precision,
}: {
  candles: CandleDto[];
  forming: CandleDto | null;
  precision: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Bumped whenever the chart is (re)created so the data effects re-apply.
  const [chartVersion, setChartVersion] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0e1621" },
        textColor: "#93a2b4",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#1c2836" }, horzLines: { color: "#1c2836" } },
      rightPriceScale: { borderColor: "#253243" },
      timeScale: { borderColor: "#253243", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#2fbd85",
      downColor: "#e0526a",
      wickUpColor: "#2fbd85",
      wickDownColor: "#e0526a",
      borderVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    setChartVersion((v) => v + 1);

    return () => {
      chart.remove();
      seriesRef.current = null;
    };
  }, [precision]);

  useEffect(() => {
    seriesRef.current?.setData(candles.map(toBar));
  }, [candles, chartVersion]);

  // lightweight-charts throws if update() is given a time older than the last
  // bar, so the forming candle is drawn only once it is strictly newer.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !forming) return;
    const last = candles.at(-1);
    if (last && forming.openTs <= last.openTs) return;
    series.update(toBar(forming));
  }, [forming, candles, chartVersion]);

  return <div ref={containerRef} className="h-[420px] w-full" />;
}
