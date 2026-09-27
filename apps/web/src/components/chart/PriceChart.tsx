"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  LineType,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createTextWatermark,
  type BarData,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type LineData,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleDto, TradeView } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { formatMinor } from "@/lib/format-money";
import { countdown } from "@/lib/format-time";
import { TIMEFRAME_SEC, type ChartState } from "./engine-state";
import type { ChartType } from "./chart-types";
import { HlcAreaSeriesView } from "./plugins/hlc-area-series";
import { VolumeCandlesSeriesView } from "./plugins/volume-candles-series";

const BRAND = "#2f81f7";
const BRAND_INK = "#ffffff";
const UP = "#3be584";
const DOWN = "#e5413b";
const CROSSHAIR = "rgba(47, 129, 247, 0.32)";
const WATERMARK = "rgba(47, 129, 247, 0.045)";
const CANDLE_SEC = TIMEFRAME_SEC["1m"];
/** Fetch older history once the left edge is within this many bars of the start. */
const LOAD_OLDER_TRIGGER_BARS = 12;
/**
 * How long, in milliseconds, the displayed price takes to glide to each new
 * value from the engine. This is a real time-based transition (frame-rate
 * independent), so every update — however big the jump — eases in over this
 * duration with an ease-out curve and then rests until the next update. This is
 * the one number to change for a slower/faster transition; keep it below the
 * gap between updates (TICK_DT_SEC × 1000) so each glide finishes before the
 * next price arrives.
 */
const PRICE_TRANSITION_MS = 600;
/**
 * How long, in milliseconds, the graph transformation wave takes to travel from
 * the latest point (right) backwards across the entire chart to the end (left).
 * 1200ms (1.2 seconds) gives a relaxed, graceful, and smooth right-to-left sweep.
 */
const CHART_TRANSFORM_DURATION_MS = 2000;

function toBar(c: CandleDto): CandlestickData {
  return { time: c.openTs as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c };
}

function toHollowBar(c: CandleDto, prevClose: number): CandlestickData {
  const isUpTrend = c.c >= prevClose;
  const themeColor = isUpTrend ? UP : DOWN;
  const isIntraBarUp = c.c >= c.o;
  const bodyColor = isIntraBarUp ? "transparent" : themeColor;
  return {
    time: c.openTs as UTCTimestamp,
    open: c.o,
    high: c.h,
    low: c.l,
    close: c.c,
    color: bodyColor,
    borderColor: themeColor,
    wickColor: themeColor,
  };
}

function toSingleValue(c: CandleDto): LineData {
  return { time: c.openTs as UTCTimestamp, value: c.c };
}

/**
 * The candle width the chart opens at, chosen so a fresh chart looks right on
 * each screen size — wider candles on phones (fewer, legible bars), tighter on
 * desktop (more history in view). This is only the DEFAULT: zoom stays enabled,
 * so the user can pinch/scroll to any spacing from here.
 */
function defaultBarSpacing(): number {
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  if (w < 640) return 10; // phone
  if (w < 1024) return 12; // tablet
  return 14; // desktop
}

/** The forming candle when it is newer than history, else the last closed one. */
function latestCandle(chart: ChartState): CandleDto | undefined {
  const last = chart.candles.at(-1);
  return chart.forming && (!last || chart.forming.openTs > last.openTs) ? chart.forming : last;
}

function formatOhlc(c: { o: number; h: number; l: number; c: number }, precision: number): string {
  const f = (n: number) => n.toFixed(precision);
  return `O ${f(c.o)}  H ${f(c.h)}  L ${f(c.l)}  C ${f(c.c)}`;
}

function createSeriesForType(
  chart: IChartApi,
  type: ChartType,
  precision: number,
  basePrice = 0,
): ISeriesApi<any> {
  const priceFormat = { type: "price" as const, precision, minMove: 10 ** -precision };

  switch (type) {
    case "bars":
      return chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DOWN,
        openVisible: true,
        thinBars: false,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "hlc_bars":
      return chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DOWN,
        openVisible: false,
        thinBars: false,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "hollow_candles":
      return chart.addSeries(CandlestickSeries, {
        upColor: "transparent",
        downColor: DOWN,
        borderVisible: true,
        wickVisible: true,
        borderColor: UP,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "volume_candles":
      return chart.addCustomSeries(new VolumeCandlesSeriesView(), {
        upColor: UP,
        downColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "hlc_area":
      return chart.addCustomSeries(new HlcAreaSeriesView(), {
        highLineColor: "#089981",
        highLineWidth: 1.5,
        highFillColor: "rgba(8, 153, 129, 0.20)",
        lowLineColor: "#f23645",
        lowLineWidth: 1.5,
        lowFillColor: "rgba(242, 54, 69, 0.20)",
        closeLineColor: "#cbd5e1",
        closeLineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "area":
      return chart.addSeries(AreaSeries, {
        topColor: "rgba(47, 129, 247, 0.38)",
        bottomColor: "rgba(47, 129, 247, 0.0)",
        lineColor: BRAND,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "line":
      return chart.addSeries(LineSeries, {
        color: BRAND,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "line_markers":
      return chart.addSeries(LineSeries, {
        color: BRAND,
        lineWidth: 2,
        pointMarkersVisible: true,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "step_line":
      return chart.addSeries(LineSeries, {
        color: BRAND,
        lineWidth: 2,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "baseline":
      return chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: basePrice },
        topLineColor: UP,
        bottomLineColor: DOWN,
        topFillColor1: "rgba(59, 229, 132, 0.3)",
        topFillColor2: "rgba(59, 229, 132, 0.0)",
        bottomFillColor1: "rgba(229, 65, 59, 0.0)",
        bottomFillColor2: "rgba(229, 65, 59, 0.3)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
    case "candles":
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        borderVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      });
  }
}

function populateSeriesData(
  series: ISeriesApi<any>,
  chartType: ChartType,
  state: ChartState,
) {
  if (state.candles.length === 0) return;
  const isOhlc =
    chartType === "candles" ||
    chartType === "bars" ||
    chartType === "hlc_bars" ||
    chartType === "hollow_candles" ||
    chartType === "volume_candles" ||
    chartType === "hlc_area";

  if (chartType === "hollow_candles") {
    (series as ISeriesApi<"Candlestick">).setData(
      state.candles.map((c, i) => {
        const prevClose = i > 0 ? state.candles[i - 1]!.c : c.o;
        return toHollowBar(c, prevClose);
      }),
    );
  } else if (isOhlc) {
    (series as ISeriesApi<"Candlestick">).setData(state.candles.map(toBar));
  } else {
    (series as ISeriesApi<"Line">).setData(state.candles.map(toSingleValue));
    if (chartType === "baseline") {
      (series as ISeriesApi<"Baseline">).applyOptions({
        baseValue: { type: "price", price: state.candles[0]!.c },
      });
    }
  }
}

function applySeriesAlpha(series: ISeriesApi<any>, type: ChartType, alpha: number) {
  const a = Math.max(0, Math.min(1, alpha));
  const aFixed = a.toFixed(3);

  switch (type) {
    case "candles":
      series.applyOptions({
        upColor: `rgba(59, 229, 132, ${aFixed})`,
        downColor: `rgba(229, 65, 59, ${aFixed})`,
        wickUpColor: `rgba(59, 229, 132, ${aFixed})`,
        wickDownColor: `rgba(229, 65, 59, ${aFixed})`,
      });
      break;

    case "bars":
      series.applyOptions({
        upColor: `rgba(59, 229, 132, ${aFixed})`,
        downColor: `rgba(229, 65, 59, ${aFixed})`,
      });
      break;

    case "hlc_bars":
      series.applyOptions({
        upColor: `rgba(59, 229, 132, ${aFixed})`,
        downColor: `rgba(229, 65, 59, ${aFixed})`,
      });
      break;

    case "hollow_candles":
      series.applyOptions({
        upColor: "transparent",
        downColor: `rgba(229, 65, 59, ${aFixed})`,
        borderColor: `rgba(59, 229, 132, ${aFixed})`,
        borderUpColor: `rgba(59, 229, 132, ${aFixed})`,
        borderDownColor: `rgba(229, 65, 59, ${aFixed})`,
        wickUpColor: `rgba(59, 229, 132, ${aFixed})`,
        wickDownColor: `rgba(229, 65, 59, ${aFixed})`,
      });
      break;

    case "volume_candles":
      series.applyOptions({
        upColor: `rgba(59, 229, 132, ${aFixed})`,
        downColor: `rgba(229, 65, 59, ${aFixed})`,
        wickUpColor: `rgba(59, 229, 132, ${aFixed})`,
        wickDownColor: `rgba(229, 65, 59, ${aFixed})`,
      });
      break;

    case "hlc_area":
      series.applyOptions({
        highLineColor: `rgba(8, 153, 129, ${aFixed})`,
        highFillColor: `rgba(8, 153, 129, ${(0.2 * a).toFixed(3)})`,
        lowLineColor: `rgba(242, 54, 69, ${aFixed})`,
        lowFillColor: `rgba(242, 54, 69, ${(0.2 * a).toFixed(3)})`,
        closeLineColor: `rgba(203, 213, 225, ${aFixed})`,
      });
      break;

    case "area":
      series.applyOptions({
        lineColor: `rgba(47, 129, 247, ${aFixed})`,
        topColor: `rgba(47, 129, 247, ${(0.38 * a).toFixed(3)})`,
        bottomColor: `rgba(47, 129, 247, 0)`,
      });
      break;

    case "line":
    case "line_markers":
    case "step_line":
      series.applyOptions({
        color: `rgba(47, 129, 247, ${aFixed})`,
      });
      break;

    case "baseline":
      series.applyOptions({
        topLineColor: `rgba(59, 229, 132, ${aFixed})`,
        bottomLineColor: `rgba(229, 65, 59, ${aFixed})`,
        topFillColor1: `rgba(59, 229, 132, ${(0.3 * a).toFixed(3)})`,
        topFillColor2: `rgba(59, 229, 132, 0)`,
        bottomFillColor1: `rgba(229, 65, 59, 0)`,
        bottomFillColor2: `rgba(229, 65, 59, ${(0.3 * a).toFixed(3)})`,
      });
      break;
  }
}

/**
 * The interactive chart. Market data never passes through React props or state:
 * the component subscribes to the market store and pushes each change into
 * lightweight-charts directly (`series.update` per tick, `setData` only when
 * history is replaced), so a tick costs a canvas draw and no render.
 */
export function PriceChart({
  market,
  precision,
  watermark,
  openTrades,
  currency,
  chartType = "candles",
}: {
  market: MarketStore;
  precision: number;
  watermark: string;
  openTrades: TradeView[];
  currency: string;
  chartType?: ChartType;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const countdownRef = useRef<HTMLDivElement | null>(null);
  const ohlcRef = useRef<HTMLDivElement | null>(null);
  const hoveringRef = useRef(false);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const [chartVersion, setChartVersion] = useState(0);

  // Seamless in-engine wave transformation state (from latest point to the end)
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const activeOldSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [hudLabel, setHudLabel] = useState<string | null>(null);
  const hudTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Chart Instance Lifecycle: Created once on mount (or when precision changes)
  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7d7a72",
        // next/font renames the family, so read it from the token rather than by name.
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(47, 129, 247, 0.07)" },
        horzLines: { color: "rgba(47, 129, 247, 0.07)" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.1 } },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 14,
        barSpacing: defaultBarSpacing(),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
        horzLine: { color: CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
      },
      autoSize: true,
    });

    const basePrice = market.getSnapshot().chart.candles[0]?.c ?? 0;
    const initialSeries = createSeriesForType(chart, chartType, precision, basePrice);
    populateSeriesData(initialSeries, chartType, market.getSnapshot().chart);

    priceLineRef.current = initialSeries.createPriceLine({
      price: 0,
      color: BRAND,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: false,
      axisLabelVisible: false,
      axisLabelColor: BRAND,
      axisLabelTextColor: BRAND_INK,
    });

    const pane = chart.panes()[0];
    watermarkRef.current = pane ? createTextWatermark(pane, { horzAlign: "center", vertAlign: "center", lines: [] }) : null;

    // OHLC shows the hovered bar, or the latest one when not hovering.
    chart.subscribeCrosshairMove((param) => {
      const activeSeries = seriesRef.current;
      if (!activeSeries) return;
      const raw = param.seriesData.get(activeSeries);
      hoveringRef.current = Boolean(raw);
      const latest = latestCandle(market.getSnapshot().chart);
      let shown: { o: number; h: number; l: number; c: number } | undefined;
      if (raw) {
        if ("open" in raw && typeof raw.open === "number") {
          shown = { o: raw.open, h: raw.high, l: raw.low, c: raw.close };
        } else if ("value" in raw && typeof raw.value === "number") {
          shown = { o: raw.value, h: raw.value, l: raw.value, c: raw.value };
        }
      } else {
        shown = latest;
      }
      if (ohlcRef.current) ohlcRef.current.textContent = shown ? formatOhlc(shown, precision) : "";
    });

    chartRef.current = chart;
    seriesRef.current = initialSeries;
    prevChartTypeRef.current = chartType;
    setChartVersion((v) => v + 1);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      activeOldSeriesRef.current = null;
      priceLineRef.current = null;
      watermarkRef.current = null;
      tradeLinesRef.current = [];
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [precision, market]);

  // 2. Progressive Wave Transformation from the latest point (right) backwards to the start (left)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !containerRef.current) return;
    if (prevChartTypeRef.current === chartType) return;

    const oldType = prevChartTypeRef.current;
    const oldSeries = seriesRef.current;
    prevChartTypeRef.current = chartType;

    // Cancel any previous wave animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // Clean up any old series lingering from rapid switching
    if (activeOldSeriesRef.current && activeOldSeriesRef.current !== oldSeries) {
      try {
        chart.removeSeries(activeOldSeriesRef.current);
      } catch { }
      activeOldSeriesRef.current = null;
    }

    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Save exact time scale position
    const range = chart.timeScale().getVisibleLogicalRange();

    // Create new series in the same chart
    const allCandles = market.getSnapshot().chart.candles;
    const N = allCandles.length;
    const basePrice = allCandles[0]?.c ?? 0;
    const newSeries = createSeriesForType(chart, chartType, precision, basePrice);

    // Re-attach live price line to new series
    priceLineRef.current = newSeries.createPriceLine({
      price: 0,
      color: BRAND,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: false,
      axisLabelVisible: false,
      axisLabelColor: BRAND,
      axisLabelTextColor: BRAND_INK,
    });

    // Restore exact time range
    if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }

    // Set new series as active for crosshair and live streaming
    seriesRef.current = newSeries;
    setChartVersion((v) => v + 1);

    // Show HUD toast of style name
    const styleLabel = chartType
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    setHudLabel(styleLabel);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHudLabel(null), 1400);

    if (reducedMotion || !oldSeries || N <= 1) {
      populateSeriesData(newSeries, chartType, market.getSnapshot().chart);
      if (oldSeries) {
        try {
          chart.removeSeries(oldSeries);
        } catch { }
      }
      return;
    }

    // Mark old series for cleanup
    activeOldSeriesRef.current = oldSeries;

    // Wave animation: begins at the latest candle (right) and sweeps backwards to index 0 (left)
    const duration = CHART_TRANSFORM_DURATION_MS; // 1200ms smooth right-to-left sweep
    const startTime = performance.now();
    let lastK = -1;

    const transformWave = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Easing: starts gracefully at the latest point, flows smoothly across history to the left
      const eased = 1 - Math.pow(1 - progress, 2);

      // K starts at (N - 1) and counts down to 0
      const K = Math.max(0, Math.min(N - 1, Math.round((N - 1) * (1 - eased))));

      if (K !== lastK) {
        lastK = K;
        // Left portion [0 .. K] is rendered in the old graph style
        const oldSlice = allCandles.slice(0, K + 1);
        // Right portion [K .. N-1] is rendered in the new graph style (min 2 points for line/area)
        const newSlice = allCandles.slice(Math.max(0, Math.min(K, N - 2)));

        if (oldSlice.length > 0) {
          populateSeriesData(oldSeries, oldType, { ...market.getSnapshot().chart, candles: oldSlice });
        }
        if (newSlice.length > 0) {
          populateSeriesData(newSeries, chartType, { ...market.getSnapshot().chart, candles: newSlice });
        }

        if (range) {
          chart.timeScale().setVisibleLogicalRange(range);
        }
      }

      if (progress < 1 && K > 0) {
        animFrameRef.current = requestAnimationFrame(transformWave);
      } else {
        // Wave has reached the end! Finalize full dataset on new series and remove old series
        populateSeriesData(newSeries, chartType, market.getSnapshot().chart);
        try {
          chart.removeSeries(oldSeries);
        } catch { }
        activeOldSeriesRef.current = null;
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(transformWave);
  }, [chartType, precision, market]);

  // Streams market data into the chart without rendering.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const priceLine = priceLineRef.current;
    if (!chart || !series || !priceLine) return;

    let prev: ChartState | null = null;

    // The displayed price glides to each new engine value over a fixed
    // transition time (PRICE_TRANSITION_MS) with an ease-out curve, then rests
    // until the next value. Because updates are seconds apart, this reads as a
    // deliberate move-and-hold rather than constant motion. The forming candle
    // follows the glide: its close tracks the eased price and its high/low grow
    // to the envelope of the eased path, so the wick extends smoothly with the
    // body instead of snapping ahead to the raw extreme.
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const eps = 10 ** -precision / 2;
    let displayed: number | null = null;
    let target: number | null = null;
    // Active glide: from `tweenFrom` toward `tweenTo`, starting at `tweenStart`.
    let tweenFrom = 0;
    let tweenTo: number | null = null;
    let tweenStart = 0;
    let formingBar: CandlestickData | null = null;
    // The displayed forming candle we grow ourselves (see comment above).
    let bucketTime: Time | null = null;
    let dispHigh = NaN;
    let dispLow = NaN;
    let paintedTime: Time | null = null;
    let paintedHigh = NaN;
    let paintedLow = NaN;
    let paintedClose = NaN;
    let paintedPrice = NaN;
    let raf = 0;
    const isOhlc =
      chartType === "candles" ||
      chartType === "bars" ||
      chartType === "hlc_bars" ||
      chartType === "hollow_candles" ||
      chartType === "volume_candles" ||
      chartType === "hlc_area";

    const paintPrice = () => {
      raf = requestAnimationFrame(paintPrice);
      if (target === null) return;

      if (displayed === null || reducedMotion) {
        displayed = target;
        tweenTo = target;
      } else {
        // A new engine value starts a fresh glide from wherever we are now.
        if (target !== tweenTo) {
          tweenFrom = displayed;
          tweenTo = target;
          tweenStart = performance.now();
        }
        if (displayed !== tweenTo) {
          const t = Math.min(1, (performance.now() - tweenStart) / PRICE_TRANSITION_MS);
          const e = 1 - (1 - t) ** 3; // ease-out cubic
          displayed = tweenFrom + (tweenTo - tweenFrom) * e;
          if (t >= 1 || Math.abs(tweenTo - displayed) <= eps) displayed = tweenTo;
        }
      }

      if (formingBar) {
        if (formingBar.time !== bucketTime) {
          // New candle: seed its envelope at the bucket's open/extremes.
          bucketTime = formingBar.time;
          dispHigh = Math.max(formingBar.open, formingBar.high);
          dispLow = Math.min(formingBar.open, formingBar.low);
        }
        dispHigh = Math.max(dispHigh, displayed, formingBar.open, formingBar.high);
        dispLow = Math.min(dispLow, displayed, formingBar.open, formingBar.low);
        if (
          formingBar.time !== paintedTime ||
          dispHigh !== paintedHigh ||
          dispLow !== paintedLow ||
          displayed !== paintedClose
        ) {
          if (isOhlc) {
            if (chartType === "hollow_candles") {
              const state = market.getSnapshot().chart;
              const lastClosed = state.candles.at(-1);
              const prevClose = lastClosed ? lastClosed.c : formingBar.open;
              const isUpTrend = displayed >= prevClose;
              const themeColor = isUpTrend ? UP : DOWN;
              const isIntraBarUp = displayed >= formingBar.open;
              const bodyColor = isIntraBarUp ? "transparent" : themeColor;
              (series as ISeriesApi<"Candlestick">).update({
                time: formingBar.time,
                open: formingBar.open,
                high: dispHigh,
                low: dispLow,
                close: displayed,
                color: bodyColor,
                borderColor: themeColor,
                wickColor: themeColor,
              });
            } else {
              (series as ISeriesApi<"Candlestick">).update({
                time: formingBar.time,
                open: formingBar.open,
                high: dispHigh,
                low: dispLow,
                close: displayed,
              });
            }
          } else {
            (series as ISeriesApi<"Line">).update({
              time: formingBar.time,
              value: displayed,
            });
          }
          paintedTime = formingBar.time;
          paintedHigh = dispHigh;
          paintedLow = dispLow;
          paintedClose = displayed;
        }
      }
      if (displayed !== paintedPrice) {
        priceLine.applyOptions({ price: displayed, lineVisible: true, axisLabelVisible: true });
        paintedPrice = displayed;
      }
    };

    const placeCountdown = () => {
      const label = countdownRef.current;
      if (!label) return;
      const state = market.getSnapshot().chart;
      const lastTs = latestCandle(state)?.openTs;
      const y = state.lastPrice === null ? null : series.priceToCoordinate(state.lastPrice);
      const x = lastTs === undefined ? null : chart.timeScale().timeToCoordinate(lastTs as UTCTimestamp);
      if (y === null || x === null) {
        label.hidden = true;
        return;
      }
      label.hidden = false;
      label.textContent = countdown(CANDLE_SEC - (Math.floor(Date.now() / 1000) % CANDLE_SEC));
      label.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 9)}px)`;
    };

    const draw = () => {
      const state = market.getSnapshot().chart;
      if (state === prev) return;

      // When the chart switches to a different symbol, reset the eased
      // display price so the first tick on the new asset snaps to its own
      // price instead of easing from the old asset's level — that glide
      // would paint a multi-thousand-point wick onto the forming candle.
      if (prev && state.symbol !== prev.symbol) {
        displayed = null;
        target = null;
        tweenTo = null;
        formingBar = null;
        bucketTime = null;
        dispHigh = NaN;
        dispLow = NaN;
        paintedTime = null;
        paintedHigh = NaN;
        paintedLow = NaN;
        paintedClose = NaN;
        paintedPrice = NaN;
        priceLine.applyOptions({ lineVisible: false, axisLabelVisible: false });
      }

      // Closed history is written straight through; the forming bar and the
      // last-price line are handed to the eased paint loop below.
      if (!prev || state.candles !== prev.candles) {
        if (chartType === "hollow_candles") {
          (series as ISeriesApi<"Candlestick">).setData(
            state.candles.map((c, i) => {
              const prevClose = i > 0 ? state.candles[i - 1]!.c : c.o;
              return toHollowBar(c, prevClose);
            }),
          );
        } else if (isOhlc) {
          (series as ISeriesApi<"Candlestick">).setData(state.candles.map(toBar));
        } else {
          (series as ISeriesApi<"Line">).setData(state.candles.map(toSingleValue));
          if (chartType === "baseline" && state.candles.length > 0) {
            (series as ISeriesApi<"Baseline">).applyOptions({
              baseValue: { type: "price", price: state.candles[0]!.c },
            });
          }
        }
      }

      const last = state.candles.at(-1);
      const formingValid =
        state.forming && (!last || state.forming.openTs > last.openTs) ? state.forming : null;
      formingBar = formingValid ? toBar(formingValid) : null;

      if (state.lastPrice === null) {
        target = null;
        priceLine.applyOptions({ lineVisible: false, axisLabelVisible: false });
      } else {
        target = state.lastPrice;
      }

      if (!hoveringRef.current && ohlcRef.current) {
        const latest = latestCandle(state);
        ohlcRef.current.textContent = latest ? formatOhlc(latest, precision) : "";
      }

      prev = state;
      placeCountdown();
    };

    // Scroll-left history: when the left edge nears the earliest loaded bar,
    // pull older candles. The store guards against duplicate/exhausted loads,
    // so calling this on every range change is cheap. lightweight-charts keeps
    // the view time-anchored across the resulting setData, so bars don't jump.
    const maybeLoadOlder = (range: { from: number; to: number } | null) => {
      if (range && range.from < LOAD_OLDER_TRIGGER_BARS) market.loadOlder();
    };

    draw();
    raf = requestAnimationFrame(paintPrice);
    const unsubscribe = market.subscribe(draw);
    const timer = setInterval(placeCountdown, 1000);
    chart.timeScale().subscribeVisibleLogicalRangeChange(placeCountdown);
    chart.timeScale().subscribeVisibleLogicalRangeChange(maybeLoadOlder);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      clearInterval(timer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(placeCountdown);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(maybeLoadOlder);
    };
  }, [market, precision, chartVersion, chartType]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !watermarkRef.current) return;
    const fontSize = Math.round(Math.min(el.clientWidth / 4.2, el.clientHeight / 1.6));
    watermarkRef.current.applyOptions({
      lines: watermark ? [{ text: watermark, color: WATERMARK, fontSize, fontStyle: "bold" }] : [],
    });
  }, [watermark, chartVersion]);

  // Entry lines for this account's open trades on this asset.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of tradeLinesRef.current) series.removePriceLine(line);
    tradeLinesRef.current = openTrades.map((t) =>
      series.createPriceLine({
        price: t.entryPrice,
        color: t.direction === "UP" ? UP : DOWN,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        axisLabelTextColor: BRAND_INK,
        title: `${t.direction === "UP" ? "▲" : "▼"} ${formatMinor(t.stake, currency)}`,
      }),
    );
  }, [openTrades, currency, chartVersion]);

  return (
    <>
      {/* z-0 gives the chart its own stacking context so lightweight-charts'
          internal z-index:50 canvases stay trapped below the overlay controls
          (timeframe tabs, fullscreen) instead of leaking up and eating clicks. */}
      <div ref={containerRef} className="absolute inset-0 z-0 cursor-crosshair" />



      {/* Style Switch HUD Pill */}
      {hudLabel && (
        <div
          className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2 rounded-full border border-brand/50 bg-[#0c121d]/85 px-3 py-1 text-xs font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200"
          aria-live="polite"
        >
          <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8]" />
          <span className="tracking-wide text-[11px]">{hudLabel}</span>
        </div>
      )}

      <div
        ref={countdownRef}
        hidden
        className="pointer-events-none absolute left-0 top-0 h-[18px] rounded-[1px] bg-brand px-[5px] text-[10px] font-semibold leading-[18px] text-brand-ink"
      />
      <div
        ref={ohlcRef}
        className="pointer-events-none absolute bottom-[34px] left-2 whitespace-pre text-[11px] tracking-[0.02em] text-ink-2"
      />
    </>
  );
}
