"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createTextWatermark,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ITextWatermarkPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { CandleDto, TradeView } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { formatMinor } from "@/lib/format-money";
import { countdown } from "@/lib/format-time";
import { TIMEFRAME_SEC, type ChartState } from "./engine-state";

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

function toBar(c: CandleDto): CandlestickData {
  return { time: c.openTs as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c };
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

/**
 * The candle chart. Market data never passes through React props or state:
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
}: {
  market: MarketStore;
  precision: number;
  watermark: string;
  openTrades: TradeView[];
  currency: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const countdownRef = useRef<HTMLDivElement | null>(null);
  const ohlcRef = useRef<HTMLDivElement | null>(null);
  const hoveringRef = useRef(false);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const [chartVersion, setChartVersion] = useState(0);

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
        // Default candle size tuned per screen; zoom/pan stay enabled so the
        // user can change it freely from here.
        barSpacing: defaultBarSpacing(),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
        horzLine: { color: CROSSHAIR, labelBackgroundColor: "#1c1c1c" },
      },
      autoSize: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });

    // The last price is drawn as our own blue line so its axis label can be
    // blue too; the series' built-in label takes the candle colour.
    priceLineRef.current = series.createPriceLine({
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
      const bar = param.seriesData.get(series) as CandlestickData | undefined;
      hoveringRef.current = Boolean(bar);
      const latest = latestCandle(market.getSnapshot().chart);
      const shown = bar ? { o: bar.open, h: bar.high, l: bar.low, c: bar.close } : latest;
      if (ohlcRef.current) ohlcRef.current.textContent = shown ? formatOhlc(shown, precision) : "";
    });

    chartRef.current = chart;
    seriesRef.current = series;
    setChartVersion((v) => v + 1);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
      watermarkRef.current = null;
      tradeLinesRef.current = [];
    };
  }, [precision, market]);

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
          // New candle: seed its envelope at the bucket's open price.
          bucketTime = formingBar.time;
          dispHigh = formingBar.open;
          dispLow = formingBar.open;
        }
        dispHigh = Math.max(dispHigh, displayed, formingBar.open);
        dispLow = Math.min(dispLow, displayed, formingBar.open);
        if (
          formingBar.time !== paintedTime ||
          dispHigh !== paintedHigh ||
          dispLow !== paintedLow ||
          displayed !== paintedClose
        ) {
          series.update({ time: formingBar.time, open: formingBar.open, high: dispHigh, low: dispLow, close: displayed });
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
        series.setData(state.candles.map(toBar));
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
  }, [market, precision, chartVersion]);

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
