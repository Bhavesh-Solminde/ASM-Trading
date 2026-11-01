"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import type { TradeView } from "@asm/contracts";
import { usePlatform, useQuote } from "@/components/shell/PlatformProvider";
import type { MarketStore } from "@/components/shell/market-store";
import { useNowSec } from "@/lib/use-now";
import { cfdOpenPnl, formatMinor } from "@asm/client-core";
import { BRACKET_KINDS, BRACKET_LABEL, bracketChanges, bracketError, bracketFromPnl, bracketPnl, defaultBracketPrice, savedBrackets, snapBracketPrice, type BracketKind, type BracketLevels } from "./bracket-model";
import { draggedBracketPrice, expandedBracketRange, type BracketDragRange } from "./bracket-drag";
import styles from "./ChartBrackets.module.css";

const COLORS = { buy: "#2962ff", sell: "#f23645", stopLoss: "#f23645", takeProfit: "#089981" };
type Draft = { tradeId: string; base: BracketLevels; levels: BracketLevels };
type ProtectionRequest = { controller: AbortController; tradeId: string; timer?: ReturnType<typeof setTimeout> };
type RowGeometry = { entry: number | null; stopLoss: number | null; takeProfit: number | null };
type Geometry = { width: number; height: number; axis: number; rows: Record<string, RowGeometry> };
type Drag = { tradeId: string; kind: BracketKind; startY: number; pointerY: number; anchor: number; pricePerPixel: number; extraPixels: number; frame: number; lastFrame: number | null; range: BracketDragRange; moved: boolean; before: Draft | null; release: (restore?: boolean) => void };
const emptyGeometry: Geometry = { width: 0, height: 0, axis: 65, rows: {} };

function Cross({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" /></svg>; }
function Edit() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m10.5 2.5 3 3-7.5 7.5-3.5.5.5-3.5 7.5-7.5Z" stroke="currentColor" strokeWidth="1.2"/><path d="m9 4 3 3" stroke="currentColor"/></svg>; }
function money(value: number | null, currency: string): string { return value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMinor(Math.abs(value), currency)}`; }

function ProtectionDialog({ children, className }: { children: ReactNode; className: string }) {
  const [compact, setCompact] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 1023px)");
    if (!media) return;
    const update = () => setCompact(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!compact) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? []);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [compact]);
  const dialog = <section ref={ref} role="dialog" aria-modal={compact || undefined} aria-label="Edit position protection" className={className}>{children}</section>;
  return compact ? createPortal(<><div className={styles.mobileBackdrop} aria-hidden="true" />{dialog}</>, document.body) : dialog;
}

export function ChartBrackets({ trades, seriesRef, chartRef, containerRef, precision, tickSize, currency, chartVersion, market, controlsEnabled = true, focusedTradeId, onSelectTrade, onShowAllTrades, actionsContainer }: {
  actionsContainer?: HTMLElement | null | undefined;
  trades: TradeView[]; seriesRef: RefObject<ISeriesApi<any> | null>; chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>; precision: number; tickSize: number; currency: string; chartVersion: number; market: MarketStore; controlsEnabled?: boolean; focusedTradeId?: string | undefined; onSelectTrade?: ((id: string) => void) | undefined; onShowAllTrades?: (() => void) | undefined;
}) {
  const now = useNowSec();
  const positions = useMemo(() => trades.filter(t => t.durationSec != null && (t.id === focusedTradeId || t.status === "OPEN" && (now == null || t.expiryTs > now))), [trades, now, focusedTradeId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const editor = controlsEnabled && positions.some(t => t.id === editorId && t.status === "OPEN" && (now == null || t.expiryTs > now));
  const [draggingKind, setDraggingKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dockVisible, setDockVisible] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Partial<Record<BracketKind, string>>>({});
  const [moneyInputs, setMoneyInputs] = useState<Partial<Record<BracketKind, string>>>({});
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(emptyGeometry);
  const selected = positions.find(t => t.id === (draft?.tradeId ?? editorId ?? selectedId)) ?? positions[0];
  const readOnly = selected?.status !== "OPEN" || now != null && selected.expiryTs <= now;
  const livePrice = useQuote(selected?.symbol ?? "")?.price ?? null;
  const { recordTradeUpdate } = usePlatform();
  const draftRef = useRef(draft); draftRef.current = draft;
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef(0);
  const restoreDraftScale = useRef<(() => void) | null>(null);
  const modelRef = useRef({ positions, draft }); modelRef.current = { positions, draft };
  const linesRef = useRef<{ series: ISeriesApi<any> | null; lines: Map<string, IPriceLine> }>({ series: null, lines: new Map() });
  const scheduleRef = useRef<() => void>(() => {});
  const mounted = useRef(true);
  const requestRef = useRef<ProtectionRequest | null>(null);
  const actionsRef = useRef({ cancel: () => {} });
  const currentLevels = selected && draft?.tradeId === selected.id ? draft.levels : selected ? savedBrackets(selected) : null;
  const changes = draft ? bracketChanges(draft.base, draft.levels) : {};
  const dirty = Object.keys(changes).length > 0;
  const inputError = editor && (Object.values(priceInputs).some(value => value === "" || !Number.isFinite(Number(value)) || Number(value) <= 0) || Object.values(moneyInputs).some(value => value === "" || !Number.isFinite(Number(value)))) ? "Enter a valid price and amount." : null;
  const validation = inputError ?? (selected ? BRACKET_KINDS.filter(k => changes[k] !== undefined).map(k => bracketError(k, changes[k]!, selected.direction, livePrice)).find(Boolean) ?? null : null);

  function updateDraft(next: Draft | null) { draftRef.current = next; setDraft(next); }
  function getDraft(trade: TradeView): Draft {
    if (draftRef.current?.tradeId === trade.id) return draftRef.current;
    const base = savedBrackets(trade);
    return { tradeId: trade.id, base, levels: { ...base } };
  }
  function cancel() {
    if (requestRef.current) return;
    const gesture = dragRef.current; dragRef.current = null; gesture?.release(); setDraggingKind(null);
    restoreDraftScale.current?.(); restoreDraftScale.current = null;
    setDockVisible(false);
    updateDraft(null); setEditorId(null); setPriceInputs({}); setMoneyInputs({}); setNotice(null);
  }
  actionsRef.current.cancel = cancel;

  useEffect(() => {
    mounted.current = true;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") actionsRef.current.cancel(); };
    window.addEventListener("keydown", key);
    return () => { mounted.current = false; window.removeEventListener("keydown", key); const drag = dragRef.current; dragRef.current = null; drag?.release(); restoreDraftScale.current?.(); restoreDraftScale.current = null; requestRef.current?.controller.abort(); clearTimeout(requestRef.current?.timer); requestRef.current = null; };
  }, []);
  // A ticket can be open without a draft. Its owner, not draft existence,
  // determines whether the editor and reserved chart width are still valid.
  useLayoutEffect(() => {
    const owner = draft?.tradeId ?? editorId;
    if (owner && (!controlsEnabled || !positions.some(t => t.id === owner && t.status === "OPEN" && (now == null || t.expiryTs > now)))) {
      const gesture = dragRef.current; dragRef.current = null; gesture?.release(); setDraggingKind(null);
      requestRef.current?.controller.abort(); clearTimeout(requestRef.current?.timer); requestRef.current = null; setBusy(false);
      restoreDraftScale.current?.(); restoreDraftScale.current = null; setDockVisible(false);
      updateDraft(null); setEditorId(null); setPriceInputs({}); setMoneyInputs({});
      setNotice({ text: "Position closed. Its protection is no longer active." });
    }
  }, [positions, draft?.tradeId, editorId, controlsEnabled, now]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // Container queries resolve before the native chart's ResizeObserver runs.
  // JS resize callbacks can briefly leave a 318px gutter on a phone, producing
  // a negative plot width inside Lightweight Charts during the transition.
  useLayoutEffect(() => {
    const el = containerRef.current; const parent = el?.parentElement;
    if (!el || !parent) return;
    const previousContainerType = parent.style.containerType;
    parent.style.containerType = "inline-size";
    el.classList.add(styles.chartCanvas!);
    if (editor) el.dataset.protectionEditor = "open";
    else delete el.dataset.protectionEditor;
    return () => {
      delete el.dataset.protectionEditor;
      el.classList.remove(styles.chartCanvas!);
      parent.style.containerType = previousContainerType;
    };
  }, [editor, chartVersion, containerRef]);

  function selectPosition(id: string) {
    if (requestRef.current || id === selected?.id) return;
    const gesture = dragRef.current; dragRef.current = null; gesture?.release(); setDraggingKind(null);
    const discarded = draftRef.current && Object.keys(bracketChanges(draftRef.current.base, draftRef.current.levels)).length > 0;
    updateDraft(null); setSelectedId(id); setEditorId(editor ? id : null);
    setPriceInputs({}); setMoneyInputs({});
    setNotice(discarded ? { text: "Unconfirmed edits discarded. Saved protection was not changed." } : null);
  }
  function editPosition(trade: TradeView) {
    if (requestRef.current || editorId === trade.id || trade.status !== "OPEN" || now != null && trade.expiryTs <= now) return;
    if (draftRef.current && draftRef.current.tradeId !== trade.id) selectPosition(trade.id);
    setSelectedId(trade.id); setPriceInputs({}); setMoneyInputs({}); setEditorId(trade.id); setNotice(null);
  }
  // Keep one set of native price lines. Draft movement updates prices rather than
  // recreating chart objects, and active protection remains visible until ack.
  useLayoutEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (linesRef.current.series !== series) {
      const old = linesRef.current;
      for (const line of old.lines.values()) { try { old.series?.removePriceLine(line); } catch {} }
      linesRef.current = { series, lines: new Map() };
    }
    const used = new Set<string>();
    function line(key: string, value: number, color: string, dashed: boolean, axis = true) {
      used.add(key);
      const options = { price: value, color, lineWidth: 1 as const, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: axis, axisLabelColor: color, axisLabelTextColor: "#fff", title: "" };
      const old = linesRef.current.lines.get(key);
      if (old) old.applyOptions(options);
      else linesRef.current.lines.set(key, series!.createPriceLine(options));
    }
    for (const t of positions) {
      const active = t.id === selected?.id;
      line(`${t.id}:entry`, t.entryPrice, (t.direction === "UP" ? COLORS.buy : COLORS.sell) + (active ? "" : "66"), false, active);
      const saved = savedBrackets(t); const preview = draft?.tradeId === t.id ? draft : null;
      for (const kind of BRACKET_KINDS) {
        const changed = preview && saved[kind] !== preview.levels[kind];
        if (saved[kind] != null) line(`${t.id}:${kind}:active`, saved[kind]!, changed || !active ? `${COLORS[kind]}66` : COLORS[kind], true, active && !changed);
        if (changed && preview.levels[kind] != null) line(`${t.id}:${kind}:draft`, preview.levels[kind]!, COLORS[kind], true);
      }
    }
    for (const [key, native] of linesRef.current.lines) if (!used.has(key)) { series.removePriceLine(native); linesRef.current.lines.delete(key); }
    scheduleRef.current();
  }, [positions, draft, chartVersion, seriesRef, selected?.id]);
  useEffect(() => () => {
    const old = linesRef.current;
    for (const line of old.lines.values()) { try { old.series?.removePriceLine(line); } catch {} }
    old.lines.clear();
  }, []);

  // Chart/store events drive layout. No polling timer and no scale changes while
  // dragging; labels always use the same coordinate conversion as native lines.
  useLayoutEffect(() => {
    const el = containerRef.current; const chart = chartRef.current;
    if (!el || !chart) return;
    function draw() {
      frameRef.current = 0;
      const series = seriesRef.current; if (!series) return;
      const rows: Geometry["rows"] = {};
      for (const t of modelRef.current.positions) {
        const d = modelRef.current.draft;
        const levels = d?.tradeId === t.id ? d.levels : savedBrackets(t);
        rows[t.id] = { entry: series.priceToCoordinate(t.entryPrice), stopLoss: levels.stopLoss == null ? null : series.priceToCoordinate(levels.stopLoss), takeProfit: levels.takeProfit == null ? null : series.priceToCoordinate(levels.takeProfit) };
      }
      const next = { width: el!.clientWidth, height: el!.clientHeight - chart!.timeScale().height(), axis: chart!.priceScale("right").width(), rows };
      setGeometry(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    }
    function schedule() {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
        // Lightweight Charts resolves autoscaling in its render frame. Measure
        // after that render, so fitting never leaves HTML labels on old prices.
        frameRef.current = requestAnimationFrame(draw);
      });
    }
    scheduleRef.current = schedule;
    const observer = new ResizeObserver(schedule); observer.observe(el);
    const unsubscribe = market.subscribe(schedule);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.subscribeCrosshairMove(schedule);
    el.addEventListener("wheel", schedule, { passive: true });
    const move = (e: PointerEvent) => { if (e.buttons) schedule(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", schedule);
    schedule();
    return () => { observer.disconnect(); unsubscribe(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); chart.unsubscribeCrosshairMove(schedule); el.removeEventListener("wheel", schedule); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", schedule); cancelAnimationFrame(frameRef.current); frameRef.current = 0; scheduleRef.current = () => {}; };
  }, [chartVersion, containerRef, chartRef, seriesRef, market]);

  function getDefault(trade: TradeView, kind: BracketKind) {
    const series = seriesRef.current;
    const a = series?.coordinateToPrice(geometry.height * .25);
    const b = series?.coordinateToPrice(geometry.height * .75);
    const current = market.getSnapshot().quotes[trade.symbol]?.price ?? trade.entryPrice;
    return defaultBracketPrice(kind, trade, current, a != null && b != null ? Math.abs(a - b) * 2 : current * .002, tickSize, precision);
  }
  function changeLevel(trade: TradeView, kind: BracketKind, value: number | null) {
    if (requestRef.current || trade.status !== "OPEN") return;
    const next = getDraft(trade);
    if (!dragRef.current) setDockVisible(true);
    updateDraft({ ...next, levels: { ...next.levels, [kind]: value } });
    setSelectedId(trade.id); setNotice(null);
  }
  function abortDrag() {
    const drag = dragRef.current; if (!drag) return;
    dragRef.current = null; drag.release(); setDraggingKind(null);
    updateDraft(drag.before); scheduleRef.current();
  }
  useEffect(() => {
    const abort = () => abortDrag();
    window.addEventListener("blur", abort);
    window.addEventListener("pointerup", abort);
    window.addEventListener("pointercancel", abort);
    return () => { window.removeEventListener("blur", abort); window.removeEventListener("pointerup", abort); window.removeEventListener("pointercancel", abort); };
  }, []);
  function applyDrag(drag: Drag) {
    const d = draftRef.current;
    if (!d || d.tradeId !== drag.tradeId) return;
    const value = draggedBracketPrice(drag.anchor, drag.pointerY - drag.startY + drag.extraPixels, drag.pricePerPixel, tickSize, precision);
    const range = expandedBracketRange(drag.range, value, tickSize);
    if (range.from !== drag.range.from || range.to !== drag.range.to) {
      drag.range = range;
      chartRef.current?.priceScale("right").setVisibleRange(range);
    }
    updateDraft({ ...d, levels: { ...d.levels, [drag.kind]: value } });
    scheduleRef.current();
  }
  function edgeDragFrame(time: number) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const y = drag.pointerY - bounds.top;
    const height = containerRef.current!.clientHeight - (chartRef.current?.timeScale().height() ?? 0);
    const speed = y < 24 ? -60 : y > height - 24 ? 60 : 0;
    if (!speed) { drag.lastFrame = null; return; }
    const elapsed = drag.lastFrame == null ? 0 : Math.min(32, Math.max(0, time - drag.lastFrame));
    drag.lastFrame = time;
    drag.extraPixels += speed * elapsed / 1000;
    if (elapsed > 0) { drag.moved = true; applyDrag(drag); }
    drag.frame = requestAnimationFrame(edgeDragFrame);
  }
  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, trade: TradeView, kind: BracketKind) {
    if (requestRef.current || trade.status !== "OPEN" || now != null && trade.expiryTs <= now || (draft && draft.tradeId !== trade.id)) return;
    e.preventDefault(); e.stopPropagation();
    const series = seriesRef.current, scale = chartRef.current?.priceScale("right");
    if (!series || !scale) return;
    // Capture BEFORE changing the scale. Never convert a floating edge badge's
    // screen position into a new price: its saved level is the drag anchor.
    const mid = Math.max(2, geometry.height / 2);
    const a = series.coordinateToPrice(mid - 1), b = series.coordinateToPrice(mid + 1);
    if (a == null || b == null || !Number.isFinite(a - b) || a === b) return;
    const pricePerPixel = Math.abs(a - b) / 2;
    const range = scale.getVisibleRange();
    if (!range || !Number.isFinite(range.from + range.to) || range.from >= range.to) return;
    const initialRange = { ...range }, auto = scale.options().autoScale;
    const restore = () => { try { if (auto) scale.applyOptions({ autoScale: true }); else scale.setVisibleRange(initialRange); } catch {} };
    if (!restoreDraftScale.current) restoreDraftScale.current = restore;
    const before = draftRef.current, next = getDraft(trade), anchor = next.levels[kind] ?? trade.entryPrice;
    setDraggingKind(trade.id + kind); setEditorId(null); setNotice(null); setSelectedId(trade.id);
    updateDraft({ ...next, levels: { ...next.levels, [kind]: anchor } });
    const target = e.currentTarget, pointerId = e.pointerId;
    let released = false;
    const drag: Drag = { tradeId: trade.id, kind, startY: e.clientY, pointerY: e.clientY, anchor, pricePerPixel, extraPixels: 0, frame: 0, lastFrame: null, range: initialRange, moved: false, before,
      release: (restoreRange = true) => {
        if (released) return; released = true;
        cancelAnimationFrame(drag.frame);
        if (restoreRange) restore();
        else if (auto) {
          // Edge expansion uses a fixed range only while dragging. Restore
          // automatic scaling, with exits included until the next chart gesture.
          fitTradeLevels(trade.id);
        }
        try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch {}
      } };
    dragRef.current = drag;
    scale.applyOptions({ autoScale: false });
    try { target.setPointerCapture(pointerId); } catch { abortDrag(); }
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.pointerY = e.clientY;
    if (Math.abs(e.clientY - drag.startY) < 3 && !drag.moved) return;
    drag.moved = true;
    applyDrag(drag);
    if (!drag.frame) drag.frame = requestAnimationFrame(edgeDragFrame);
  }
  function endDrag(e: ReactPointerEvent<HTMLButtonElement>, aborted = false) {
    const drag = dragRef.current; if (!drag) return;
    dragRef.current = null; drag.release(aborted || !drag.moved); setDraggingKind(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (aborted) updateDraft(drag.before);
    else setDockVisible(true);
    if (!aborted && !drag.moved) {
      const t = positions.find(t => t.id === drag.tradeId);
      if (t && savedBrackets(t)[drag.kind] == null) changeLevel(t, drag.kind, getDefault(t, drag.kind));
      // Existing exits stay drag-first; a tap does not open the numeric editor.
    }
    scheduleRef.current();
  }
  function fitLevels() {
    if (selected) fitTradeLevels(selected.id);
  }
  function fitTradeLevels(ownerId: string) {
    const series = seriesRef.current; if (!series) return;
    fitCleanup.current?.(); fitCleanup.current = null;
    const original = series.options().autoscaleInfoProvider;
    series.applyOptions({ autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const info = base(); if (!info?.priceRange) return info;
      const trade = modelRef.current.positions.find(t => t.id === ownerId);
      const levels = draftRef.current?.tradeId === ownerId ? draftRef.current.levels : trade ? savedBrackets(trade) : null;
      const values = [trade?.entryPrice, levels?.stopLoss, levels?.takeProfit].filter((v): v is number => v != null);
      const min = Math.min(info.priceRange.minValue, ...values), max = Math.max(info.priceRange.maxValue, ...values), pad = Math.max((max - min) * .1, tickSize * 10);
      return { ...info, priceRange: { minValue: min - pad, maxValue: max + pad } };
    } });
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    // Return to normal chart fitting after the user leaves this position.
    fitCleanup.current = () => { try { series.applyOptions({ autoscaleInfoProvider: original }); } catch {} };
    scheduleRef.current();
  }
  const fitCleanup = useRef<(() => void) | null>(null);
  useEffect(() => { if (focusedTradeId) fitLevels(); }, [focusedTradeId, chartVersion]);
  useEffect(() => () => { fitCleanup.current?.(); fitCleanup.current = null; }, [selected?.id, chartVersion]);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const releaseFit = () => { if (dragRef.current) return; restoreDraftScale.current = null; fitCleanup.current?.(); fitCleanup.current = null; scheduleRef.current(); };
    el.addEventListener("pointerdown", releaseFit); el.addEventListener("wheel", releaseFit, { passive: true });
    return () => { el.removeEventListener("pointerdown", releaseFit); el.removeEventListener("wheel", releaseFit); };
  }, [containerRef, chartVersion]);

  async function confirm() {
    const d = draftRef.current; const t = positions.find(t => t.id === d?.tradeId);
    if (!d || !t || t.status !== "OPEN" || now != null && t.expiryTs <= now || requestRef.current || !mounted.current) return;
    if (inputError) { setNotice({ text: inputError, error: true }); return; }
    const patch = bracketChanges(d.base, d.levels); if (!Object.keys(patch).length) { cancel(); return; }
    const current = market.getSnapshot().quotes[t.symbol]?.price ?? null;
    const error = BRACKET_KINDS.filter(k => patch[k] !== undefined).map(k => bracketError(k, patch[k]!, t.direction, current)).find(Boolean);
    if (error) { setNotice({ text: error, error: true }); return; }
    const request: ProtectionRequest = { controller: new AbortController(), tradeId: t.id };
    requestRef.current = request; setBusy(true); setNotice(null);
    request.timer = setTimeout(() => {
      if (requestRef.current !== request || !mounted.current) return;
      request.controller.abort(); requestRef.current = null; setBusy(false);
      setNotice({ text: "The update timed out. Check the position’s saved levels before retrying.", error: true });
    }, 15000);
    try {
      const res = await fetch(`/api/cfd/trades/${t.id}`, { method: "PATCH", signal: request.controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await res.json();
      if (!mounted.current || requestRef.current !== request || request.controller.signal.aborted) return;
      if (!res.ok || !data.trade) throw new Error(data.error === "invalid_stops" ? "The market moved past this level. Adjust the bracket and confirm again." : data.error === "trade_not_open" ? "This position has already closed." : "Protection was not changed. Check the connection and try again.");
      restoreDraftScale.current = null;
      recordTradeUpdate(data.trade);
      if (mounted.current && draftRef.current?.tradeId === t.id) {
        updateDraft(null); setEditorId(null); setNotice({ text: "Position protection updated" });
      }
    } catch (e) { if (mounted.current && requestRef.current === request && !request.controller.signal.aborted) setNotice({ text: e instanceof Error ? e.message : "Protection was not changed.", error: true }); }
    finally { clearTimeout(request.timer); if (requestRef.current === request) { requestRef.current = null; if (mounted.current) setBusy(false); } }
  }

  if (!controlsEnabled || !positions.length || !selected) return null;
  const axisRight = geometry.axis + 16;
  const activeGeometry = geometry.rows[selected.id];
  const isInChart = (y: number | null | undefined): y is number => y != null && y >= 18 && y <= geometry.height - 18;
  const orderColor = selected.direction === "UP" ? COLORS.buy : COLORS.sell;
  const pnl = readOnly ? selected.pnl : cfdOpenPnl(selected, livePrice);
  const dragEvents = (t: TradeView, kind: BracketKind) => ({ onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => beginDrag(e, t, kind), onPointerMove: moveDrag, onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => endDrag(e), onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => endDrag(e, true), onLostPointerCapture: (e: ReactPointerEvent<HTMLButtonElement>) => endDrag(e, true), onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault(); const value = (draftRef.current?.tradeId === t.id ? draftRef.current.levels[kind] : savedBrackets(t)[kind]) ?? getDefault(t,kind);
      changeLevel(t, kind, snapBracketPrice(value + (e.key === "ArrowUp" ? tickSize : -tickSize),tickSize,precision));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); if (savedBrackets(t)[kind] == null && draftRef.current?.levels[kind] == null) changeLevel(t,kind,getDefault(t,kind)); else editPosition(t);
    }
  } });
  const infoError = notice?.error ? notice.text : validation;
  const reward = currentLevels?.takeProfit != null ? bracketPnl(selected, currentLevels.takeProfit) : null;
  const risk = currentLevels?.stopLoss != null ? -bracketPnl(selected, currentLevels.stopLoss) : null;
  const ratio = reward != null && risk != null && reward > 0 && risk > 0 ? `1 : ${(reward / risk).toFixed(2)}` : "—";

  return <div className={styles.root} data-focused={!!focusedTradeId} data-testid="chart-trading" style={{ "--order-color": orderColor } as CSSProperties}>
    {focusedTradeId && onShowAllTrades && <button type="button" className={styles.allTrades} disabled={busy || !!draggingKind} onClick={onShowAllTrades}>All trades</button>}
    {!editor && dockVisible && draft && dirty && (() => {
      const controls = <div className={styles.confirm} role="group" aria-label="Confirm protection changes"><button type="button" onClick={cancel} disabled={busy || !!draggingKind}>Cancel</button><button type="button" className={styles.primary} onClick={() => void confirm()} disabled={busy || !!draggingKind || !!validation}>{busy ? "Updating…" : "Confirm"}</button></div>;
      return actionsContainer ? createPortal(controls, actionsContainer) : controls;
    })()}
    <div className={styles.plot} style={{ width: geometry.width || "100%" }}>
    {activeGeometry && (draft || selectedId === selected.id) && BRACKET_KINDS.map(kind => {
      const y = activeGeometry[kind], entry = activeGeometry.entry;
      if (!isInChart(y) || !isInChart(entry) || currentLevels?.[kind] == null) return null;
      const left = Math.max(24, geometry.width * .55), right = geometry.axis + 8;
      return <div key={kind} className={styles.zone} style={{ top: Math.min(entry, y), height: Math.abs(entry - y), left, right, background: `${COLORS[kind]}12`, borderColor: `${COLORS[kind]}66` }}>

      </div>;
    })}
    {activeGeometry && isInChart(activeGeometry.entry) && (draft || selectedId === selected.id) && (() => {
      const ys = [activeGeometry.entry, activeGeometry.stopLoss, activeGeometry.takeProfit].filter(isInChart);
      return <><div className={styles.connector} style={{ right: geometry.axis + 9, top: Math.min(...ys), height: Math.max(...ys) - Math.min(...ys) }} />{ys.map((y, i) => <div key={i} className={styles.node} style={{ right: geometry.axis + 7, top: y }} />)}</>;
    })()}
    {positions.map(t => {
      const g = geometry.rows[t.id]; if (!g) return null;
      const active = t.id === selected.id;
      const levels = draft?.tradeId === t.id ? draft.levels : savedBrackets(t);
      const tColor = t.direction === "UP" ? COLORS.buy : COLORS.sell;
      const closeToSelected = !active && isInChart(g.entry) && isInChart(activeGeometry?.entry) && Math.abs(g.entry - activeGeometry.entry) < 34;
      return <div key={t.id} style={{ "--order-color": tColor } as CSSProperties}>
        {isInChart(g.entry) && !closeToSelected && <div className={styles.row} style={{ top: g.entry }}>
          <div className={`${styles.group} ${active ? styles.selected : ""} ${draft?.tradeId === t.id ? styles.draft : ""}`} style={{ right: axisRight }}>
            {active && !readOnly && <div className={styles.handles}>
              {BRACKET_KINDS.filter(k => levels[k] == null || draggingKind === t.id + k && savedBrackets(t)[k] == null).map(kind => <button key={kind} type="button" title={`Drag to add ${kind === "takeProfit" ? "Take Profit" : "Stop Loss"}`} aria-label={`Add ${BRACKET_LABEL[kind]} to ${t.direction === "UP" ? "Buy" : "Sell"} position`} disabled={busy} className={`${styles.handle} ${kind === "takeProfit" ? styles.tp : styles.sl}`} {...dragEvents(t, kind)}>{BRACKET_LABEL[kind]}</button>)}
            </div>}
            <div className={styles.position}>
              <button type="button" className={styles.side} aria-label={`Select ${t.direction === "UP" ? "Buy" : "Sell"} ${formatMinor(t.stake, currency)} position`} disabled={busy} onClick={() => onSelectTrade ? onSelectTrade(t.id) : selectPosition(t.id)}>{t.direction === "UP" ? "Buy" : "Sell"} {formatMinor(t.stake, currency)}</button>
              {active && positions.length > 1 && <span className={styles.positionSelect}>
                <select aria-label="Selected chart position" value={selected.id} disabled={busy} onChange={e => selectPosition(e.target.value)}>
                  {positions.map((p,i) => <option key={p.id} value={p.id}>{i + 1}. {p.direction === "UP" ? "Buy" : "Sell"} {formatMinor(p.stake,currency)} @ {p.entryPrice.toFixed(precision)}</option>)}
                </select><span aria-hidden>▾</span>
              </span>}
              {active && activeGeometry && [activeGeometry.stopLoss,activeGeometry.takeProfit].some(y => y != null && !isInChart(y)) && <button type="button" className={styles.edit} aria-label="Fit position exits" title="Fit position exits" onClick={fitLevels}>↕</button>}
              <button type="button" className={styles.edit} aria-label="Edit position protection" title="Edit position protection" disabled={busy || t.status !== "OPEN" || !!draft && draft.tradeId !== t.id} onClick={() => editPosition(t)}><Edit /></button>
            </div>
          </div>
        </div>}
        {BRACKET_KINDS.map(kind => {
          if (!active) return null;
          const level = levels[kind], y = g[kind]; if (level == null) return null;
          const offscreen = !isInChart(y);
          if (offscreen && !active) return null;
          // Keep a selected exit reachable without pretending its true price
          // is at the edge. The badge shows direction + exact offscreen price;
          // its native line remains at the actual price on the price scale.
          const above = y == null ? level > t.entryPrice : y < geometry.height / 2;
          const edgeSlot = kind === "stopLoss" ? 32 : 0;
          const rowY = offscreen ? (above ? 20 + edgeSlot : Math.max(20, geometry.height - 22 - edgeSlot)) : y;
          const pending = draft?.tradeId === t.id && draft.base[kind] !== level;
          const invalid = pending && bracketError(kind, level, t.direction, livePrice);
          return <div key={kind} className={`${styles.row} ${styles.exitRow}`} data-dragging={draggingKind === t.id + kind} style={{ top: rowY, "--bracket-color": COLORS[kind] } as CSSProperties}>
            <div className={styles.group} style={{ right: axisRight, opacity: active ? 1 : .6 }}>
              <div className={`${styles.bracket} ${pending ? styles.pending : ""} ${invalid ? styles.invalid : ""} ${busy ? styles.saving : ""} ${offscreen ? styles.edgeBracket : ""}`}>
                <button type="button" className={styles.label} aria-label={`Drag ${BRACKET_LABEL[kind]} level`} title={`${pending ? "Unconfirmed " : ""}${BRACKET_LABEL[kind]} ${level.toFixed(precision)} · drag to modify, double-click to edit`} disabled={busy || t.status !== "OPEN" || !!draft && draft.tradeId !== t.id} {...dragEvents(t, kind)} onDoubleClick={() => editPosition(t)}>{BRACKET_LABEL[kind]}{offscreen ? above ? " ↑" : " ↓" : ""}</button>
                <button type="button" className={styles.outcome} aria-label={`${BRACKET_LABEL[kind]} at ${level.toFixed(precision)}${offscreen ? " outside chart" : ""}`} title={`Price ${level.toFixed(precision)} · ${pending ? "not confirmed" : "active"}`} disabled={busy || t.status !== "OPEN" || !!draft && draft.tradeId !== t.id} {...dragEvents(t, kind)} onDoubleClick={() => editPosition(t)}>{money(bracketPnl(t, level), currency)}</button>
                {offscreen && <button type="button" className={styles.edgeEdit} aria-label={`Fit ${BRACKET_LABEL[kind]} in chart`} title="Fit this level in chart" disabled={busy} onClick={fitLevels}>↕</button>}
                <button type="button" className={styles.remove} aria-label={`Remove ${BRACKET_LABEL[kind]}`} title={`Remove ${BRACKET_LABEL[kind]}`} disabled={busy || t.status !== "OPEN" || !!draft && draft.tradeId !== t.id} onClick={() => changeLevel(t, kind, null)}><Cross /></button>
              </div>
            </div>
          </div>;
        })}
      </div>;
    })}
    {activeGeometry && !isInChart(activeGeometry.entry) && <div className={styles.offscreen} style={{ bottom: 32 }}>
      <button type="button" disabled={busy} onClick={() => readOnly ? fitLevels() : editPosition(selected)}>{readOnly ? "View closed" : "Manage"} {selected.direction === "UP" ? "Buy" : "Sell"} position</button>
      <button type="button" onClick={fitLevels}>↕ Fit position and exits</button>
    </div>}

    {!editor && draft && dirty && !notice && !validation && <span className="sr-only" role="status">Preview only. Current protection stays active until you confirm.</span>}
    {!editor && (notice || validation) && (() => {
      const message = <div className={styles.notice} role={infoError ? "alert" : "status"} data-error={!!infoError}>
        {infoError ?? notice?.text}
        {!draft && notice && <button type="button" aria-label="Dismiss trading notice" onClick={() => setNotice(null)}><Cross /></button>}
      </div>;
      return actionsContainer ? createPortal(message, actionsContainer) : message;
    })()}
    </div>
    {editor && currentLevels && <ProtectionDialog className={styles.editor!}>
      <header><strong>{selected.symbol.replace("USDT", "/USDT")}</strong><button type="button" aria-label="Close protection editor" disabled={busy} onClick={cancel}><Cross size={16}/></button></header>
      <div className={styles.editorBody}>
        {positions.length > 1 && <label className={styles.positionPicker}>Position
          <select aria-label="Protection editor position" value={selected.id} disabled={busy} onChange={e => selectPosition(e.target.value)}>
            {positions.map((p,i) => <option key={p.id} value={p.id}>{i+1}. {p.direction === "UP" ? "Buy" : "Sell"} {formatMinor(p.stake,currency)} @ {p.entryPrice.toFixed(precision)}</option>)}
          </select><small>Switching position discards unconfirmed edits.</small>
        </label>}
        <p className={styles.summary}>{selected.direction === "UP" ? "Buy" : "Sell"} {formatMinor(selected.stake,currency)} @ {selected.entryPrice.toFixed(precision)}</p>
        <div className={styles.exits}><strong>Exits</strong><span>Risk/reward · {ratio}</span></div>
        {BRACKET_KINDS.map(kind => {
          const value = currentLevels[kind]; const net = value == null ? null : bracketPnl(selected,value);
          return <div key={kind} className={styles.field}>
            <label><input type="checkbox" aria-label={`Enable ${BRACKET_LABEL[kind]}`} checked={value != null} disabled={busy} onChange={e => { setPriceInputs(old => { const next = {...old}; delete next[kind]; return next; }); setMoneyInputs(old => { const next = {...old}; delete next[kind]; return next; }); changeLevel(selected,kind,e.target.checked ? getDefault(selected,kind) : null); }} />{kind === "takeProfit" ? "Take profit" : "Stop loss"}</label>
            <div className={styles.fieldGrid}>
              <label>Price<input aria-label={`${BRACKET_LABEL[kind]} price`} type="number" min={tickSize} step={tickSize} value={priceInputs[kind] ?? value ?? ""} disabled={busy || value == null} onChange={e => {
                const text = e.target.value; setPriceInputs(old => ({ ...old, [kind]: text }));
                setMoneyInputs(old => { const next = {...old}; delete next[kind]; return next; });
                if (text !== "" && Number.isFinite(Number(text)) && Number(text) > 0) changeLevel(selected,kind,snapBracketPrice(Number(text),tickSize,precision));
              }} onBlur={() => { if (priceInputs[kind] && Number(priceInputs[kind]) > 0) setPriceInputs(old => { const next = {...old}; delete next[kind]; return next; }); }}/></label>
              <label>{kind === "takeProfit" ? "Reward" : "Risk"}, {currency}<input aria-label={`${BRACKET_LABEL[kind]} ${kind === "takeProfit" ? "reward" : "risk"}`} type="number" step="0.01" value={moneyInputs[kind] ?? (net == null ? "" : Number(((kind === "takeProfit" ? net : -net)/100).toFixed(2)))} disabled={busy || value == null} onChange={e => { const text = e.target.value; setMoneyInputs(old => ({ ...old, [kind]: text })); if (text !== "" && Number.isFinite(Number(text))) {
                const next = bracketFromPnl(selected,Math.round(Number(text)*100)*(kind === "takeProfit"?1:-1),tickSize,precision);
                changeLevel(selected,kind,next);
                setPriceInputs(old => { const values = {...old}; delete values[kind]; return values; });
              } }} onBlur={() => { if (moneyInputs[kind] && Number.isFinite(Number(moneyInputs[kind]))) setMoneyInputs(old => { const next = {...old}; delete next[kind]; return next; }); }}/></label>
            </div>
            {value != null && <div className={styles.detail}><span>{((value-selected.entryPrice)/selected.entryPrice*100).toFixed(3)}% from entry</span><span>{money(net,currency)} net</span></div>}
          </div>;
        })}
        <div className={styles.detail}><span>Opening fee paid</span><span>{formatMinor(selected.spreadFee ?? 0,currency)}</span></div>
        <div className={styles.detail}><span>Current result</span><span>{money(pnl,currency)}</span></div>
      </div>
      <footer>{infoError && <p className={styles.editorError} role="alert">{infoError}</p>}<button type="button" className={styles.primary} disabled={busy || !dirty || !!validation} onClick={() => void confirm()}>{busy ? "Updating…" : "Confirm"}</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></footer>
    </ProtectionDialog>}
  </div>;
}
