"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineType,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createTextWatermark,
  type AutoscaleInfo,
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
import { formatMinor, countdown, TIMEFRAME_SEC, type ChartState } from "@asm/client-core";
import { ChartAnalysis } from "./ChartAnalysis";
import { ChartBrackets } from "./ChartBrackets";
import type { ChartType } from "./chart-types";
import { HlcAreaSeriesView } from "./plugins/hlc-area-series";
import { VolumeCandlesSeriesView } from "./plugins/volume-candles-series";
import { recordChartMetric,finishChartSwitch } from "./diagnostics";
import { OtcExpiry } from "./OtcExpiry";
import { OtcEntryLines } from "./OtcEntryLines";
import { OtcProtection } from "./OtcProtection";
import type { OtcProtectionDraft } from "./otc-protection";

const BRAND = "#2f81f7";
const BRAND_INK = "#ffffff";
const UP = "#089981";
const DOWN = "#f23645";
const CROSSHAIR = "rgba(47, 129, 247, 0.32)";
const WATERMARK = "rgba(47, 129, 247, 0.045)";
const marketClock = new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false });
const marketTime = (time:Time) => typeof time==="number" ? marketClock.format(time*1000) : "";
/** Fetch older history once the left edge is within this many bars of the start. */
const LOAD_OLDER_TRIGGER_BARS = 12;

/**
 * Keep at least eight time slots across the plot when zooming. The pan guard
 * retains up to eight real candles, adjusted for narrow plots and space ahead.
 */
const MIN_VISIBLE_BARS = 8;
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
 * Readable candle spacing, independent of how many bars fit on the screen.
 * Users can then pinch or scroll to change the zoom.
 */
function defaultBarSpacing(): number {
  return 20;
}

/**
 * Keep the newest candle at roughly 55% of the plot, leaving room ahead.
 */
function defaultRightOffset(width: number, barSpacing: number): number {
  return Math.max(0, width * .45 / barSpacing - .5);
}

/**
 * Widest candle the user may zoom to, so MIN_VISIBLE_BARS still fit across the
 * plot. `width` is the chart element's width; the price scale eats ~56px of it,
 * so subtract that before dividing.
 */
function maxBarSpacingFor(width: number): number {
  return Math.max(8, (Math.max(120, width) - 56) / MIN_VISIBLE_BARS);
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

/**
 * Share of the auto-fit height the price action is drawn at. Auto-fit stretches
 * whatever is on screen to fill the plot, so a quiet stretch looks as violent
 * as a real move. Padding the fitted range by 1/PRICE_FILL keeps the scale
 * relative but draws every candle at 65% of its auto-fit size, leaving air above
 * and below.
 */
const PRICE_FILL = 0.65;

function shrinkAutoscale(baseImplementation: () => AutoscaleInfo | null): AutoscaleInfo | null {
  const info = baseImplementation();
  if (!info?.priceRange) return info;
  const { minValue, maxValue } = info.priceRange;
  const mid = (minValue + maxValue) / 2;
  const half = (maxValue - minValue) / PRICE_FILL / 2;
  return { ...info, priceRange: { minValue: mid - half, maxValue: mid + half } };
}

function createSeriesForType(
  chart: IChartApi,
  type: ChartType,
  precision: number,
  basePrice = 0,
  naturalScale = false,
): ISeriesApi<any> {
  const series = addSeriesForType(chart, type, precision, basePrice);
  if(!naturalScale)series.applyOptions({ autoscaleInfoProvider: shrinkAutoscale });
  return series;
}

function addSeriesForType(
  chart: IChartApi,
  type: ChartType,
  precision: number,
  basePrice: number,
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
  marketOpen = true,
  market,
  precision,
  watermark,
  openTrades,
  currency,
  chartType = "candles",
  showVolume=false,
  appearance="classic",
  protectionDraft,
  onProtectionChange,
  enableBrackets = false,
  bracketScope,
  bracketControls = true,
  bracketActionsContainer,
  focusedTradeId, onSelectTrade, onShowAllTrades,
  tickSize,
  analysisScope,
}: {
  analysisScope?: string;
  marketOpen?: boolean;
  market: MarketStore;
  precision: number;
  watermark: string;
  openTrades: TradeView[];
  currency: string;
  chartType?: ChartType;
  showVolume?:boolean;
  appearance?:"classic"|"market";
  protectionDraft?:OtcProtectionDraft|undefined;
  onProtectionChange?:(draft:OtcProtectionDraft)=>void;
  enableBrackets?: boolean;
  bracketScope?: string;
  bracketControls?: boolean;
  bracketActionsContainer?: HTMLElement | null | undefined;
  focusedTradeId?: string | undefined;
  onSelectTrade?: ((id: string) => void) | undefined;
  onShowAllTrades?: (() => void) | undefined;
  tickSize?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const countdownRef = useRef<HTMLDivElement | null>(null);
  const ohlcRef = useRef<HTMLDivElement | null>(null);
  const hoveringRef = useRef(false);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<any> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const [chartVersion, setChartVersion] = useState(0);
  const [volumePreference, setVolumePreference] = useState<{ scope: string | undefined; enabled: boolean } | null>(null);
  const volumeVisible = showVolume && volumePreference?.scope === analysisScope && volumePreference?.enabled === true;
  useEffect(() => {
    let enabled = false;
    try {
      enabled = localStorage.getItem(`asm_chart_volume:${analysisScope}`) === "true";
    } catch { /* Optional storage. */ }
    setVolumePreference({ scope: analysisScope, enabled });
  }, [analysisScope]);
  function toggleVolume() {
    const enabled = !volumeVisible;
    setVolumePreference({ scope: analysisScope, enabled });
    try {
      localStorage.setItem(`asm_chart_volume:${analysisScope}`, String(enabled));
    } catch { /* Keep the selection for this visit. */ }
  }

  // Seamless in-engine wave transformation state (from latest point to the end)
  const prevChartTypeRef = useRef<ChartType>(chartType);
  const activeOldSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [hudLabel, setHudLabel] = useState<string | null>(null);
  const hudTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Chart Instance Lifecycle: Created once on mount (or when precision changes)
  useEffect(() => {
    if (!containerRef.current) return;

    // Compact layout (same breakpoint as the `phone` variant): smaller axis text
    // narrows the price scale and shortens the time scale, giving candles room.
    const compactMq = window.matchMedia("(width < 64rem) or (height < 30rem)");
    const axisFontSize = () => (compactMq.matches ? 9 : 11);
    const marketStyle=appearance==="market";
    const spacing=defaultBarSpacing();

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: marketStyle?"#0c141c":"#0d141b" },
        textColor: marketStyle?"#a5bbc9":"#9ba8b7",
        // next/font renames the family, so read it from the token rather than by name.
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "sans-serif",
        fontSize: axisFontSize(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: marketStyle?"#16232c":"rgba(47, 129, 247, 0.07)" },
        horzLines: { color: marketStyle?"#16232c":"rgba(47, 129, 247, 0.07)" },
      },
      rightPriceScale: { borderVisible: marketStyle,borderColor:"#293a47",scaleMargins: marketStyle?{top:compactMq.matches?.24:.12,bottom:.22}:{ top: enableBrackets ? 0.24 : 0.18, bottom: 0.1 } },
      timeScale: {
        borderVisible: marketStyle,
        borderColor:"#293a47",
        timeVisible: true,
        secondsVisible: !marketStyle,
        rightOffset: defaultRightOffset(Math.max(0, containerRef.current.clientWidth - 56), spacing),
        barSpacing: spacing,
        ...(marketStyle?{tickMarkFormatter:marketTime}:{}),
        maxBarSpacing: maxBarSpacingFor(containerRef.current.clientWidth),
      },
      crosshair: {
        mode: marketStyle?CrosshairMode.Magnet:CrosshairMode.Normal,
        vertLine: { color: marketStyle?"#9598a1":CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
        horzLine: { color: marketStyle?"#9598a1":CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
      },
      ...(marketStyle?{localization:{timeFormatter:(time:Time)=>`${marketTime(time)} IST`}}:{}),
      autoSize: true,
      handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:false}},
    });

    const basePrice = market.getSnapshot().chart.candles[0]?.c ?? 0;
    const initialSeries = createSeriesForType(chart, chartType, precision, basePrice,marketStyle);
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

    const onCompactChange = () => chart.applyOptions({ layout: { fontSize: axisFontSize() },...(marketStyle?{rightPriceScale:{scaleMargins:{top:compactMq.matches?.24:.12,bottom:.22}}}:{}) });
    compactMq.addEventListener("change", onCompactChange);

    // The zoom cap is width-derived, so it has to follow the element (sidebar
    // open/close, rotate, fullscreen) and not just the initial layout.
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) chart.timeScale().applyOptions({ maxBarSpacing: maxBarSpacingFor(width) });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      compactMq.removeEventListener("change", onCompactChange);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      activeOldSeriesRef.current = null;
      priceLineRef.current = null;
      watermarkRef.current = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [precision, market,appearance]);

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
    const newSeries = createSeriesForType(chart, chartType, precision, basePrice,appearance==="market");

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

    if (reducedMotion || appearance==="market" || !oldSeries || N <= 1) {
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
  }, [chartType, precision, market,appearance]);

  // Streams market data into the chart without rendering.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const priceLine = priceLineRef.current;
    if (!chart || !series || !priceLine) return;
    // A stale last quote is still useful history, but has no live price marker.
    if (!marketOpen) {
      priceLine.applyOptions({ lineVisible: false, axisLabelVisible: false });
      if (countdownRef.current) countdownRef.current.hidden = true;
    }

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
      const began=performance.now();let changed=false;

      if (displayed === null || reducedMotion || appearance==="market") {
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
          // New candle: snap the glide. Without this, the previous bucket's
          // lingering `displayed` keeps easing toward its old target and gets
          // folded into THIS bar's high/low envelope below — painting a
          // phantom wick back to the prior candle's close on every new bar.
          // At a bucket boundary the first tick's price is both the engine's
          // open and (so far) its close, so jumping straight to it is the
          // honest "ticks are discrete at the boundary" behaviour; within-bar
          // smoothness is preserved by the glide code above on subsequent
          // ticks. Seed the envelope from the engine's own extremes, which
          // already fold in every tick that has landed in this bucket.
          bucketTime = formingBar.time;
          displayed = formingBar.close;
          tweenFrom = formingBar.close;
          tweenTo = formingBar.close;
          tweenStart = performance.now();
          dispHigh = formingBar.high;
          dispLow = formingBar.low;
        }
        dispHigh = Math.max(dispHigh, displayed, formingBar.open, formingBar.high);
        dispLow = Math.min(dispLow, displayed, formingBar.open, formingBar.low);
        if (
          formingBar.time !== paintedTime ||
          dispHigh !== paintedHigh ||
          dispLow !== paintedLow ||
          displayed !== paintedClose
        ) {
          changed=true;
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
        changed=true;
        const color=appearance==="market"?(formingBar&&formingBar.close<formingBar.open?DOWN:UP):BRAND;
        priceLine.applyOptions({ price: displayed,color,axisLabelColor:color,lineStyle:appearance==="market"?LineStyle.Dotted:LineStyle.Dashed,lineVisible: marketOpen, axisLabelVisible: marketOpen });
        paintedPrice = displayed;
      }
      if(changed)recordChartMetric("chartWork",performance.now()-began);
    };

    const placeCountdown = () => {
      const label = countdownRef.current;
      if (!label) return;
      if (!marketOpen) { label.hidden = true; return; }
      const state = market.getSnapshot().chart;
      const lastTs = latestCandle(state)?.openTs;
      const y = state.lastPrice === null ? null : series.priceToCoordinate(state.lastPrice);
      const x = lastTs === undefined ? null : chart.timeScale().timeToCoordinate(lastTs as UTCTimestamp);
      if (y === null || x === null) {
        label.hidden = true;
        return;
      }
      label.hidden = false;
      const width=TIMEFRAME_SEC[state.timeframe];
      label.textContent = countdown(width - (Math.floor(Date.now() / 1000) % width));
      label.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 9)}px)`;
    };

    const draw = () => {
      const state = market.getSnapshot().chart;
      if (state === prev) return;
      const began=performance.now();

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
        // Bulk replacements can move logical indexes beneath an existing hover.
        if (prev && (state.candles[0]?.openTs !== prev.candles[0]?.openTs || state.candles.length < prev.candles.length)) {
          chart.clearCrosshairPosition();
        }
        const sameScope=prev&&prev.symbol===state.symbol&&prev.timeframe===state.timeframe;
        const incremental=prev!==null&&sameScope&&prev.candles.length>0&&state.candles[0]?.openTs===prev.candles[0]?.openTs;
        const viewport=sameScope&&!incremental?chartRef.current?.timeScale().getVisibleLogicalRange():null;
        if(incremental&&prev){
          const last=prev.candles.at(-1)!;
          for(let i=0;i<state.candles.length;i++){
            const b=state.candles[i]!;if(b.openTs<last.openTs)continue;
            if(b.openTs===last.openTs&&b.o===last.o&&b.h===last.h&&b.l===last.l&&b.c===last.c)continue;
            const historical=b.openTs<(prev.forming?.openTs??last.openTs);
            if(chartType==="hollow_candles") (series as ISeriesApi<"Candlestick">).update(toHollowBar(b,i?state.candles[i-1]!.c:b.o),historical);
            else if(isOhlc)(series as ISeriesApi<"Candlestick">).update(toBar(b),historical);
            else (series as ISeriesApi<"Line">).update(toSingleValue(b),historical);
          }
        } else if (chartType === "hollow_candles") {
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
        if(viewport&&prev){
          const oldFirst=prev.candles[0]?.openTs,newFirst=state.candles[0]?.openTs;
          const removed=oldFirst!==undefined&&newFirst!==undefined?(oldFirst<=newFirst?Math.max(0,prev.candles.findIndex(b=>b.openTs===newFirst)):-Math.max(0,state.candles.findIndex(b=>b.openTs===oldFirst))):0;
          chartRef.current?.timeScale().setVisibleLogicalRange({from:viewport.from-removed,to:viewport.to-removed});
        }
      }

      const last = state.candles.at(-1);
      const formingValid =
        state.forming && (!last || state.forming.openTs > last.openTs) ? state.forming : null;
      formingBar = formingValid ? toBar(formingValid) : null;
      // Size the initial view to the plot, keeping readable candles and space ahead.
      if(state.candles.length&&(!prev?.candles.length||prev.symbol!==state.symbol||prev.timeframe!==state.timeframe)) {
        const lastIndex = state.candles.length - 1 + (formingValid ? 1 : 0);
        const slots = Math.max(MIN_VISIBLE_BARS, chart.timeScale().width() / defaultBarSpacing());
        const to = lastIndex + slots * .45 - .5;
        chart.timeScale().setVisibleLogicalRange({ from: to - slots + 1, to });
      }

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
      if(state.candles.length||state.forming)finishChartSwitch(`${state.symbol}:${state.timeframe}`);
      recordChartMetric("chartWork",performance.now()-began);
    };

    // Scroll-left history: when the left edge nears the earliest loaded bar,
    // pull older candles. The store guards against duplicate/exhausted loads,
    // so calling this on every range change is cheap. lightweight-charts keeps
    // the view time-anchored across the resulting setData, so bars don't jump.
    const maybeLoadOlder = (range: { from: number; to: number } | null) => {
      if (range && range.from < LOAD_OLDER_TRIGGER_BARS) market.loadOlder();
    };

    // Pan clamp: dragging the chart to the right walks the history off screen.
    // Keep some real candles visible even on narrow screens with space ahead.
    // Shift the range back by the overshoot. Re-entrant by
    // design — the range change this fires already satisfies the guard.
    const clampRightEdge = (range: { from: number; to: number } | null) => {
      if (!range) return;
      const state = market.getSnapshot().chart;
      const hasForming = state.forming !== null && latestCandle(state) === state.forming;
      const barCount = state.candles.length + (hasForming ? 1 : 0);
      if (barCount < MIN_VISIBLE_BARS) return;
      const minimum = Math.min(MIN_VISIBLE_BARS, Math.max(1, Math.floor((range.to - range.from + 1) * .6)));
      const maxFrom = barCount - minimum;
      const overshoot = range.from - maxFrom;
      if (overshoot <= 0) return;
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: range.from - overshoot, to: range.to - overshoot });
    };

    draw();
    raf = requestAnimationFrame(paintPrice);
    const unsubscribe = market.subscribe(draw);
    const timer = setInterval(placeCountdown, 1000);
    chart.timeScale().subscribeVisibleLogicalRangeChange(clampRightEdge);
    chart.timeScale().subscribeVisibleLogicalRangeChange(placeCountdown);
    chart.timeScale().subscribeVisibleLogicalRangeChange(maybeLoadOlder);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      clearInterval(timer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(clampRightEdge);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(placeCountdown);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(maybeLoadOlder);
    };
  }, [market, precision, chartVersion, chartType,appearance,marketOpen]);

  useEffect(()=>{
    const chart=chartRef.current;if(!chart||!volumeVisible)return;
    const series=chart.addSeries(HistogramSeries,{priceScaleId:"volume",priceFormat:{type:"volume"},lastValueVisible:false,priceLineVisible:false});
    chart.priceScale("volume").applyOptions({scaleMargins:{top:appearance==="market"?.86:.82,bottom:0},visible:false});
    let previous:ChartState|null=null;
    const draw=()=>{
      const state=market.getSnapshot().chart;
      const bars=state.forming?[...state.candles,state.forming]:state.candles;
      const point=(b:CandleDto)=>({time:b.openTs as UTCTimestamp,value:b.volume??0,color:b.c>=b.o?"#08998180":"#f2364580"});
      if(!previous||previous.symbol!==state.symbol||previous.timeframe!==state.timeframe||previous.candles[0]?.openTs!==state.candles[0]?.openTs)series.setData(bars.map(point));
      else{const last=previous.forming?.openTs??previous.candles.at(-1)?.openTs??0;for(const b of bars)if(b.openTs>=last)series.update(point(b));}
      previous=state;
    };
    let frame = 0;
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };
    schedule();
    const unsubscribe = market.subscribe(schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", schedule);
      cancelAnimationFrame(frame);
      if (chartRef.current === chart) chart.removeSeries(series);
    };
  },[market,volumeVisible,chartVersion,appearance]);

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
    const lines = openTrades
      .filter(t => !enableBrackets || t.durationSec == null)
      .map(t => series.createPriceLine({
        price: t.entryPrice,
        color: t.direction === "UP" ? UP : DOWN,
        lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true,
        lineVisible: t.mode !== "OTC_FIXED",
        axisLabelTextColor: BRAND_INK,
        title: `${t.direction === "UP" ? "▲" : "▼"} ${formatMinor(t.stake, t.currency??currency)}`,
      }));
    for(const trade of openTrades)if(trade.mode==="OTC_FIXED"){
      for(const [label,price,color] of [["SL",trade.stopLoss,DOWN],["TP",trade.takeProfit,UP]] as const){
        if(price!=null)lines.push(series.createPriceLine({price,color,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:label}));
      }
    }
    return ()=>{for(const line of lines)try{series.removePriceLine(line);}catch{}};
  }, [openTrades, currency, chartVersion, enableBrackets,chartType]);

  return (
    <div className="analysis-plot absolute inset-0">
      {/* z-0 gives the chart its own stacking context so lightweight-charts'
          internal z-index:50 canvases stay trapped below the overlay controls
          (timeframe tabs, fullscreen) instead of leaking up and eating clicks. */}
      <div ref={containerRef} className="absolute inset-0 z-0 cursor-crosshair" />
      <OtcEntryLines trades={openTrades} chartRef={chartRef} seriesRef={seriesRef} market={market} chartVersion={chartVersion} />
      {showVolume?<OtcExpiry trades={openTrades} chartRef={chartRef} market={market} chartVersion={chartVersion}/>:null}
      {protectionDraft&&onProtectionChange?<OtcProtection key={bracketScope} draft={protectionDraft} onChange={onProtectionChange} seriesRef={seriesRef} chartRef={chartRef} containerRef={containerRef} market={market} chartVersion={chartVersion} precision={precision} tickSize={tickSize??10**-precision}/>:null}
      {enableBrackets && <ChartBrackets key={`${bracketScope}:${focusedTradeId ?? "all"}`} focusedTradeId={focusedTradeId} onSelectTrade={onSelectTrade} onShowAllTrades={onShowAllTrades} actionsContainer={bracketActionsContainer} controlsEnabled={bracketControls} trades={openTrades} seriesRef={seriesRef} chartRef={chartRef} containerRef={containerRef}
        precision={precision} tickSize={tickSize ?? 10 ** -precision} currency={currency} chartVersion={chartVersion} market={market} />}



      {analysisScope && <ChartAnalysis key={analysisScope} scope={analysisScope} symbol={market.getSnapshot().chart.symbol} market={market} chartRef={chartRef} seriesRef={seriesRef} containerRef={containerRef} chartVersion={chartVersion} precision={precision} volumeAvailable={showVolume} volumeEnabled={volumeVisible} onVolumeChange={toggleVolume} />}

      <a className="chart-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" aria-label="Charts by TradingView" title="Charts by TradingView"><img src="/brand/tradingview-chart.svg" width="27" height="15" alt="" /></a>
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
        data-testid="chart-countdown"
        ref={countdownRef}
        hidden
        className="pointer-events-none absolute left-0 top-0 h-[18px] rounded-[1px] bg-brand px-[5px] text-[10px] font-semibold leading-[18px] text-brand-ink"
      />
      <div
        ref={ohlcRef}
        className={`pointer-events-none absolute bottom-[34px] ${appearance==="market"?"left-14 phone:left-12":"left-2 phone:left-1"} whitespace-pre text-[11px] tracking-[0.02em] text-ink-2 phone:bottom-[24px] phone:text-[9px]`}
      />
    </div>
  );
}
