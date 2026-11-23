"use client";

import { memo, useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LineStyle, type AutoscaleInfoProvider, type IChartApi, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import type { OtcSetStopsInput, TradeView } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { usePlatform } from "@/components/shell/PlatformProvider";
import { useTheme } from "@/lib/theme";
import { useNowSec } from "@/lib/use-now";
import { getChartPalette } from "./chart-palette";
import { EMPTY_STOPS, STOP_KINDS, clampStopLevel, defaultStopLevels, hasStops, sameStops, type StopKind, type TradeStops } from "./otc-trade-stops";

type Props = {
  trade: TradeView;
  seriesRef: RefObject<ISeriesApi<any> | null>;
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  bottomOverlayRef?: RefObject<HTMLDivElement | null> | undefined;
  market: MarketStore;
  chartVersion: number;
  precision: number;
  tickSize: number;
  actionsContainer?: HTMLElement | null | undefined;
  onShowAllTrades?: (() => void) | undefined;
};
type Draft = TradeStops | "new" | null;
type Geometry = { height: number; freeBottom: number; axis: number; stopLoss: number | null; takeProfit: number | null };
type Drag = {
  pointer: number;
  kind: StopKind;
  before: Draft;
  anchor: { y: number; price: number; pricePerPixel: number } | null;
  release: () => void;
};
const HALF_HANDLE = 18;
const OVERLAY_GAP = 6;
const LABEL = { stopLoss: "SL", takeProfit: "TP" };
const NAME = { stopLoss: "stop loss", takeProfit: "take profit" };
const CONTROL = "min-h-8 rounded border border-rule bg-panel px-2.5 text-xs font-semibold text-ink hover:bg-tile-hi disabled:opacity-50";

export function OtcTradeStops(props: Props) {
  const now = useNowSec();
  const trade = props.trade;
  if (trade.status !== "OPEN" || trade.pending || (now !== null && now >= trade.expiryTs)) return null;
  return <ActiveOtcTradeStops {...props} />;
}

const ActiveOtcTradeStops = memo(function ActiveOtcTradeStops({
  trade, seriesRef, chartRef, containerRef, bottomOverlayRef, market, chartVersion, precision, tickSize, actionsContainer, onShowAllTrades,
}: Props) {
  const theme = useTheme();
  const { recordTradeUpdate } = usePlatform();
  const saved = { stopLoss: trade.stopLoss ?? null, takeProfit: trade.takeProfit ?? null };
  const [draft, setDraft] = useState<Draft>(() => hasStops(saved) ? null : "new");
  const [geometry, setGeometry] = useState<Geometry>({ height: 0, freeBottom: 0, axis: 0, ...EMPTY_STOPS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ trade, saved, draft });
  const lines = useRef<IPriceLine[]>([]);
  const drag = useRef<Drag | null>(null);
  const schedule = useRef(() => {});
  const saving = useRef(false);
  const retry = useRef<{ request: OtcSetStopsInput; expected: TradeStops } | null>(null);
  const active = hasStops(saved);
  const edited = draft !== null && draft !== "new";
  const levels = edited ? draft : saved;

  useLayoutEffect(() => { latest.current = { trade, saved, draft }; });

  const writeDraft = useCallback((value: Draft) => {
    latest.current.draft = value;
    setDraft(value);
  }, []);

  const release = useCallback((cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.release();
    if (cancel) writeDraft(current.before);
    schedule.current();
  }, [writeDraft]);

  const bounds = useCallback(() => {
    const state = market.getSnapshot().chart;
    return state.symbol === latest.current.trade.symbol ? state.lastPrice : null;
  }, [market]);

  const defaults = useCallback((price: number) => {
    const series = seriesRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    const a = series?.coordinateToPrice(height * .35), b = series?.coordinateToPrice(height * .65);
    const span = a != null && b != null ? Math.abs(a - b) : null;
    return defaultStopLevels(latest.current.trade, price, tickSize, precision, span);
  }, [containerRef, precision, seriesRef, tickSize]);

  useLayoutEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const installed = STOP_KINDS.map(() => series.createPriceLine({ price: 0, lineVisible: false, axisLabelVisible: false }));
    lines.current = installed;
    return () => {
      lines.current = [];
      for (const line of installed) try { series.removePriceLine(line); } catch { /* Series can already be gone. */ }
    };
  }, [chartVersion, seriesRef]);

  useLayoutEffect(() => {
    const chart = chartRef.current, el = containerRef.current, series = seriesRef.current;
    if (!chart || !el || !series) return;
    const scale = chart.priceScale("right");
    const overlay = bottomOverlayRef?.current;
    const originalProvider = overlay ? series.options().autoscaleInfoProvider : undefined;
    let overlayTop: number | null = null;
    let fitted: { min: number; max: number; margin: number } | null = null;
    let frame = 0;
    const provider: AutoscaleInfoProvider = base => {
      const info = originalProvider ? originalProvider(base) : base();
      if (!info?.priceRange || !fitted) return info;
      const { minValue, maxValue } = info.priceRange;
      return {
        priceRange: {
          minValue: Math.min(minValue, fitted.min),
          maxValue: Math.max(maxValue, fitted.max),
        },
        margins: { above: info.margins?.above ?? 0, below: Math.max(info.margins?.below ?? 0, fitted.margin) },
      };
    };
    const restoreProvider = () => {
      if (!fitted) return;
      fitted = null;
      series.applyOptions({ autoscaleInfoProvider: originalProvider });
      scale.setAutoScale(true);
    };
    const draw = () => {
      frame = 0;
      const price = bounds();
      if (seriesRef.current !== series || price == null) return;
      const current = latest.current;
      if (current.draft === "new") {
        writeDraft(hasStops(current.saved) ? null : defaults(price));
        return;
      }
      const projected = current.draft ?? current.saved;
      if (current.draft) {
        const keepOutside = (kind: StopKind) => projected[kind] === null ? null : clampStopLevel(kind, projected[kind], current.trade, price, tickSize, precision);
        const valid = { stopLoss: keepOutside("stopLoss"), takeProfit: keepOutside("takeProfit") };
        if (!sameStops(valid, projected)) {
          writeDraft(valid);
          return;
        }
      }
      const height = chart.paneSize().height;
      const freeBottom = Math.min(height, overlayTop === null ? height : overlayTop - OVERLAY_GAP);
      if (freeBottom < height && (hasStops(projected) || hasStops(current.saved))) {
        const prices = [projected.stopLoss, projected.takeProfit, current.saved.stopLoss, current.saved.takeProfit]
          .filter((level): level is number => level !== null);
        const min = Math.min(...prices), max = Math.max(...prices);
        // The provider's pixel padding is added to the scale's existing fractional padding.
        const margins = scale.options().scaleMargins;
        const below = height - freeBottom + HALF_HANDLE;
        const margin = Math.max(0, Math.min(below, height * (1 - margins.top) - 1) - height * margins.bottom);
        if (!fitted || fitted.min !== min || fitted.max !== max || fitted.margin !== margin) {
          const install = fitted === null;
          fitted = { min, max, margin };
          if (install) series.applyOptions({ autoscaleInfoProvider: provider });
          scale.setAutoScale(true);
          queue();
        }
      } else if (fitted) {
        restoreProvider();
        queue();
      }
      const next = {
        height, freeBottom,
        axis: scale.width(),
        stopLoss: projected.stopLoss === null ? null : series.priceToCoordinate(projected.stopLoss),
        takeProfit: projected.takeProfit === null ? null : series.priceToCoordinate(projected.takeProfit),
      };
      setGeometry(old => old.height === height && old.freeBottom === freeBottom && old.axis === next.axis && old.stopLoss === next.stopLoss && old.takeProfit === next.takeProfit ? old : next);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(draw); });
    };
    schedule.current = queue;
    const measure = () => {
      const rect = overlay?.getBoundingClientRect();
      overlayTop = rect?.height ? rect.top - el.getBoundingClientRect().top : null;
      queue();
    };
    const resize = new ResizeObserver(measure);
    const cancelDrag = () => release(true);
    const time = chart.timeScale();
    resize.observe(el);
    if (overlay) resize.observe(overlay);
    const unsubscribe = market.subscribe(queue);
    time.subscribeVisibleLogicalRangeChange(queue);
    chart.subscribeCrosshairMove(queue);
    el.addEventListener("wheel", queue, { passive: true });
    window.addEventListener("blur", cancelDrag);
    measure();
    return () => {
      release();
      schedule.current = () => {};
      cancelAnimationFrame(frame);
      resize.disconnect();
      unsubscribe();
      time.unsubscribeVisibleLogicalRangeChange(queue);
      chart.unsubscribeCrosshairMove(queue);
      el.removeEventListener("wheel", queue);
      window.removeEventListener("blur", cancelDrag);
      try { restoreProvider(); } catch { /* Series or chart can already be removed. */ }
    };
  }, [bottomOverlayRef, bounds, chartRef, chartVersion, containerRef, defaults, market, precision, release, seriesRef, tickSize, writeDraft]);

  useLayoutEffect(() => {
    const palette = getChartPalette();
    const values = { stopLoss: levels.stopLoss, takeProfit: levels.takeProfit };
    STOP_KINDS.forEach((kind, i) => {
      const price = values[kind], pending = edited && price !== saved[kind];
      // PriceChart owns the saved lines, including while a draft is showing.
      lines.current[i]?.applyOptions({
        price: price ?? 0, lineVisible: pending && price !== null, axisLabelVisible: pending && price !== null,
        color: kind === "stopLoss" ? palette.down : palette.up, axisLabelTextColor: palette.labelInk,
        lineWidth: 1, lineStyle: pending ? LineStyle.Dashed : LineStyle.Solid,
        title: pending ? `${LABEL[kind]} draft` : LABEL[kind],
      });
    });
    schedule.current();
  }, [chartVersion, draft, edited, levels.stopLoss, levels.takeProfit, saved.stopLoss, saved.takeProfit, theme]);

  function setLevel(kind: StopKind, value: number | null) {
    const current = latest.current;
    const levels = current.draft && current.draft !== "new" ? current.draft : current.saved;
    if (levels[kind] === value) return;
    setError(null);
    writeDraft({ ...levels, [kind]: value });
  }

  function moveLevel(kind: StopKind, target: number) {
    const price = bounds();
    if (price == null) return;
    const level = clampStopLevel(kind, target, latest.current.trade, price, tickSize, precision);
    if (level !== null) setLevel(kind, level);
  }

  function begin(event: PointerEvent<HTMLButtonElement>, kind: StopKind) {
    if (event.button !== 0 || drag.current || saving.current) return;
    const scale = chartRef.current?.priceScale("right");
    if (!scale) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget, pointer = event.pointerId, auto = scale.options().autoScale;
    let anchor: Drag["anchor"] = null;
    if (geometry.freeBottom < geometry.height) {
      const series = seriesRef.current;
      const top = series?.coordinateToPrice(0), bottom = series?.coordinateToPrice(geometry.height);
      const price = levels[kind];
      if (top == null || bottom == null || price == null) return;
      // Keep the same price per pixel as the chart refits around the dragged level.
      anchor = { y: event.clientY, price, pricePerPixel: (top - bottom) / geometry.height };
    }
    drag.current = {
      kind, pointer, before: latest.current.draft, anchor,
      release: () => {
        if (!anchor) try { scale.applyOptions({ autoScale: auto }); } catch { /* Chart can unmount mid-drag. */ }
        try { if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer); } catch { /* Target can unmount mid-drag. */ }
      },
    };
    if (!anchor) scale.applyOptions({ autoScale: false });
    try { target.setPointerCapture(pointer); } catch { release(true); }
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current, el = containerRef.current;
    if (!current || current.pointer !== event.pointerId || !el) return;
    const rect = el.getBoundingClientRect();
    const clientY = Math.max(rect.top, Math.min(rect.top + geometry.height, event.clientY));
    const price = current.anchor
      ? current.anchor.price - (clientY - current.anchor.y) * current.anchor.pricePerPixel
      : seriesRef.current?.coordinateToPrice(clientY - rect.top);
    if (price != null) moveLevel(current.kind, price);
  }

  async function submit(levels: TradeStops) {
    if (saving.current || drag.current) return;
    const save = retry.current && sameStops(retry.current.request, levels)
      ? retry.current
      : { request: { requestId: crypto.randomUUID(), ...levels }, expected: latest.current.saved };
    retry.current = save;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/trades/${encodeURIComponent(trade.id)}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(save.request),
      });
      const result = await response.json().catch(() => null) as { trade?: TradeView; error?: string } | null;
      if (!response.ok || result?.trade?.id !== trade.id) {
        if (response.status < 500) retry.current = null;
        setError(result?.error ?? "Could not save SL / TP. Try again.");
        return;
      }
      retry.current = null;
      recordTradeUpdate(result.trade, save.expected);
      writeDraft(null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const cancel = () => { release(true); setError(null); writeDraft(null); };
  const controls = actionsContainer && createPortal(
    <div className="flex w-full flex-wrap items-center justify-between gap-1.5 border-t border-rule bg-chart px-2 py-1.5" role="group" aria-label="Trade SL / TP actions">
      <div className="flex flex-wrap items-center gap-1.5">
        {onShowAllTrades && <button type="button" className={CONTROL} onClick={onShowAllTrades}>All trades</button>}
        {draft !== "new" && (edited || active) && STOP_KINDS.filter(kind => levels[kind] === null).map(kind => (
          <button key={kind} type="button" className={CONTROL} disabled={busy} onClick={() => {
            const price = bounds();
            if (price != null) setLevel(kind, defaults(price)[kind]);
          }}>Add {LABEL[kind]}</button>
        ))}
      </div>
      {draft === "new" ? <span className="text-xs text-ink-2">Waiting for the chart…</span> : edited ? (
        <div className="ml-auto flex gap-1.5">
          <button type="button" className={CONTROL} disabled={busy} onClick={cancel}>Cancel</button>
          <button type="button" className="min-h-8 rounded bg-brand-fill px-3 text-xs font-semibold text-brand-ink disabled:opacity-50" disabled={busy || !hasStops(levels) || sameStops(levels, saved)} onClick={() => void submit(levels)}>{active ? "Update" : "Set"}</button>
        </div>
      ) : active ? (
        <button type="button" className={`${CONTROL} ml-auto`} disabled={busy} onClick={() => void submit(EMPTY_STOPS)}>Remove</button>
      ) : (
        <button type="button" className={`${CONTROL} ml-auto`} onClick={() => { setError(null); writeDraft("new"); }}>Set SL / TP</button>
      )}
      {error && <p role="alert" className="basis-full text-xs text-down">{error}</p>}
    </div>, actionsContainer,
  );

  return <>
    <div className="pointer-events-none absolute inset-0 z-20" aria-label="SL / TP chart controls">
      {STOP_KINDS.map(kind => {
        const y = geometry[kind], price = levels[kind];
        if (y === null || price === null || geometry.freeBottom < 40) return null;
        const pending = edited && price !== saved[kind];
        const label = `${LABEL[kind]}${pending ? " draft" : ""}`;
        const maxY = geometry.freeBottom - HALF_HANDLE;
        return <div key={kind} className={`pointer-events-auto absolute flex h-9 -translate-y-1/2 items-stretch rounded border border-current bg-chart-market text-xs font-bold shadow-md ${pending ? "border-dashed" : ""} ${kind === "stopLoss" ? "text-candle-down" : "text-candle-up"}`} style={{ top: Math.min(maxY, Math.max(HALF_HANDLE, y)), right: geometry.axis + 8 }}>
          <button type="button" role="slider" aria-orientation="vertical" aria-label={`Drag ${NAME[kind]}`} aria-valuenow={price} aria-valuetext={price.toFixed(precision)} disabled={busy}
            className="cursor-ns-resize touch-none! select-none px-2.5 focus-visible:outline-2 focus-visible:outline-chart-focus"
            onPointerDown={event => begin(event, kind)} onPointerMove={move}
            onPointerUp={event => { if (drag.current?.pointer === event.pointerId) release(); }}
            onPointerCancel={event => { if (drag.current?.pointer === event.pointerId) release(true); }}
            onLostPointerCapture={event => { if (drag.current?.pointer === event.pointerId) release(true); }}
            onKeyDown={event => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              moveLevel(kind, price + (event.key === "ArrowUp" ? tickSize : -tickSize) * (event.shiftKey ? 10 : 1));
            }}
          >{label}{y < HALF_HANDLE ? " ↑" : y > maxY ? " ↓" : ""}</button>
          <button type="button" aria-label={`Remove ${NAME[kind]}`} disabled={busy} className="w-8 border-l border-current text-base hover:bg-tile-hi" onClick={() => {
            if (edited) setLevel(kind, null);
            else void submit({ ...saved, [kind]: null });
          }}>×</button>
        </div>;
      })}
    </div>
    {controls}
  </>;
});
