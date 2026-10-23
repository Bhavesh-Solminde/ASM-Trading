"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import type { TradeView } from "@asm/contracts";
import { usePlatform, useQuote } from "@/components/shell/PlatformProvider";
import type { MarketStore } from "@/components/shell/market-store";
import { useNowSec } from "@/lib/use-now";
import { countdown } from "@/lib/format-time";
import { formatMinor } from "@/lib/format-money";
import { cfdOpenPnl } from "@/components/trade/pnl-display";
import { BRACKET_KINDS, BRACKET_LABEL, bracketChanges, bracketError, bracketFromPnl, bracketPnl, defaultBracketPrice, savedBrackets, snapBracketPrice, type BracketKind, type BracketLevels } from "./bracket-model";
import styles from "./ChartBrackets.module.css";

const COLORS = { buy: "#2962ff", sell: "#f23645", stopLoss: "#f23645", takeProfit: "#089981" };
type Draft = { tradeId: string; base: BracketLevels; levels: BracketLevels };
type RowGeometry = { entry: number | null; stopLoss: number | null; takeProfit: number | null };
type Geometry = { width: number; height: number; axis: number; rows: Record<string, RowGeometry> };
type Drag = { tradeId: string; kind: BracketKind; startY: number; moved: boolean; before: Draft | null; release: () => void };
const emptyGeometry: Geometry = { width: 0, height: 0, axis: 65, rows: {} };

function Cross({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" /></svg>; }
function Edit() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m10.5 2.5 3 3-7.5 7.5-3.5.5.5-3.5 7.5-7.5Z" stroke="currentColor" strokeWidth="1.2"/><path d="m9 4 3 3" stroke="currentColor"/></svg>; }
function money(value: number | null, currency: string): string { return value == null ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMinor(Math.abs(value), currency)}`; }

export function ChartBrackets({ trades, seriesRef, chartRef, containerRef, precision, tickSize, currency, chartVersion, market }: {
  trades: TradeView[]; seriesRef: RefObject<ISeriesApi<any> | null>; chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>; precision: number; tickSize: number; currency: string; chartVersion: number; market: MarketStore;
}) {
  const now = useNowSec();
  const positions = useMemo(() => trades.filter(t => t.durationSec != null && t.status === "OPEN" && (now == null || t.expiryTs > now)), [trades, now]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editor, setEditor] = useState(false);
  const [draggingKind, setDraggingKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Partial<Record<BracketKind, string>>>({});
  const [moneyInputs, setMoneyInputs] = useState<Partial<Record<BracketKind, string>>>({});
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(emptyGeometry);
  const selected = positions.find(t => t.id === (draft?.tradeId ?? selectedId)) ?? positions[0];
  const livePrice = useQuote(selected?.symbol ?? "")?.price ?? null;
  const { recordTradeUpdate } = usePlatform();
  const draftRef = useRef(draft); draftRef.current = draft;
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef(0);
  const modelRef = useRef({ positions, draft }); modelRef.current = { positions, draft };
  const linesRef = useRef<{ series: ISeriesApi<any> | null; lines: Map<string, IPriceLine> }>({ series: null, lines: new Map() });
  const scheduleRef = useRef<() => void>(() => {});
  const mounted = useRef(true);
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
    if (busy) return;
    dragRef.current?.release(); dragRef.current = null; setDraggingKind(null);
    updateDraft(null); setEditor(false); setPriceInputs({}); setMoneyInputs({}); setNotice(null);
  }
  actionsRef.current.cancel = cancel;

  useEffect(() => {
    mounted.current = true;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") actionsRef.current.cancel(); };
    window.addEventListener("keydown", key);
    return () => { mounted.current = false; window.removeEventListener("keydown", key); dragRef.current?.release(); };
  }, []);
  useEffect(() => {
    if (draft && !positions.some(t => t.id === draft.tradeId)) {
      dragRef.current?.release(); dragRef.current = null; setDraggingKind(null);
      updateDraft(null); setEditor(false); setNotice({ text: "Position closed. Its protection is no longer active." });
    }
  }, [positions, draft?.tradeId]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // The optional precision ticket reserves chart space on desktop, like the
  // reference trading ticket, instead of covering the position being edited.
  useLayoutEffect(() => {
    const el = containerRef.current; const parent = el?.parentElement;
    if (!el || !parent) return;
    const previous = el.style.right;
    const resize = () => { el.style.right = editor && parent.clientWidth >= 760 ? "318px" : previous; };
    resize(); const observer = new ResizeObserver(resize); observer.observe(parent);
    return () => { observer.disconnect(); el.style.right = previous; };
  }, [editor, chartVersion, containerRef]);

  function editPosition(trade: TradeView) {
    if (draftRef.current && draftRef.current.tradeId !== trade.id) return;
    setSelectedId(trade.id); setPriceInputs({}); setMoneyInputs({}); setEditor(true); setNotice(null);
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
      line(`${t.id}:entry`, t.entryPrice, t.direction === "UP" ? COLORS.buy : COLORS.sell, false);
      const saved = savedBrackets(t); const preview = draft?.tradeId === t.id ? draft : null;
      for (const kind of BRACKET_KINDS) {
        const changed = preview && saved[kind] !== preview.levels[kind];
        if (saved[kind] != null) line(`${t.id}:${kind}:active`, saved[kind]!, changed ? `${COLORS[kind]}66` : COLORS[kind], true, !changed);
        if (changed && preview.levels[kind] != null) line(`${t.id}:${kind}:draft`, preview.levels[kind]!, COLORS[kind], true);
      }
    }
    for (const [key, native] of linesRef.current.lines) if (!used.has(key)) { series.removePriceLine(native); linesRef.current.lines.delete(key); }
    scheduleRef.current();
  }, [positions, draft, chartVersion, seriesRef]);
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
    const next = getDraft(trade);
    updateDraft({ ...next, levels: { ...next.levels, [kind]: value } });
    setSelectedId(trade.id); setNotice(null);
  }
  function beginDrag(e: ReactPointerEvent<HTMLButtonElement>, trade: TradeView, kind: BracketKind) {
    if (busy || (draft && draft.tradeId !== trade.id)) return;
    e.preventDefault(); e.stopPropagation(); setDraggingKind(trade.id + kind); setEditor(false); setNotice(null); setSelectedId(trade.id);
    const before = draftRef.current;
    const next = getDraft(trade);
    updateDraft({ ...next, levels: { ...next.levels, [kind]: next.levels[kind] ?? trade.entryPrice } });
    const chart = chartRef.current; const scale = chart?.priceScale("right");
    const options = chart?.options(); const auto = scale?.options().autoScale;
    chart?.applyOptions({ handleScroll: false, handleScale: false }); scale?.applyOptions({ autoScale: false });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { tradeId: trade.id, kind, startY: e.clientY, moved: false, before,
      release: () => { chart?.applyOptions({ handleScroll: options?.handleScroll ?? true, handleScale: options?.handleScale ?? true }); scale?.applyOptions({ autoScale: auto ?? true }); } };
  }
  function moveDrag(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current; const d = draftRef.current;
    if (!drag || !d) return;
    if (Math.abs(e.clientY - drag.startY) < 3 && !drag.moved) return;
    drag.moved = true;
    const bounds = containerRef.current?.getBoundingClientRect(); if (!bounds) return;
    const p = seriesRef.current?.coordinateToPrice(Math.max(0, Math.min(geometry.height, e.clientY - bounds.top)));
    if (p == null || !Number.isFinite(p) || p <= 0) return;
    updateDraft({ ...d, levels: { ...d.levels, [drag.kind]: snapBracketPrice(p, tickSize, precision) } });
  }
  function endDrag(e: ReactPointerEvent<HTMLButtonElement>, aborted = false) {
    const drag = dragRef.current; if (!drag) return;
    drag.release(); dragRef.current = null; setDraggingKind(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (aborted) updateDraft(drag.before);
    else if (!drag.moved) {
      const t = positions.find(t => t.id === drag.tradeId);
      if (t && savedBrackets(t)[drag.kind] == null) changeLevel(t, drag.kind, getDefault(t, drag.kind));
      else { setPriceInputs({}); setMoneyInputs({}); setEditor(true); }
    }
    scheduleRef.current();
  }
  function fitLevels() {
    if (!selected) return;
    const series = seriesRef.current; if (!series) return;
    const values = [selected.entryPrice, currentLevels?.stopLoss, currentLevels?.takeProfit].filter((v): v is number => v != null);
    fitCleanup.current?.(); fitCleanup.current = null;
    const original = series.options().autoscaleInfoProvider;
    series.applyOptions({ autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const info = base(); if (!info?.priceRange) return info;
      const min = Math.min(info.priceRange.minValue, ...values), max = Math.max(info.priceRange.maxValue, ...values), pad = Math.max((max - min) * .1, tickSize * 10);
      return { ...info, priceRange: { minValue: min - pad, maxValue: max + pad } };
    } });
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    // Return to normal chart fitting after the user leaves this position.
    fitCleanup.current = () => { try { series.applyOptions({ autoscaleInfoProvider: original }); } catch {} };
    scheduleRef.current();
  }
  const fitCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => { fitCleanup.current?.(); fitCleanup.current = null; }, [selected?.id, chartVersion]);

  async function confirm() {
    const d = draftRef.current; const t = positions.find(t => t.id === d?.tradeId);
    if (!d || !t || busy) return;
    if (inputError) { setNotice({ text: inputError, error: true }); return; }
    const patch = bracketChanges(d.base, d.levels); if (!Object.keys(patch).length) { cancel(); return; }
    const current = market.getSnapshot().quotes[t.symbol]?.price ?? null;
    const error = BRACKET_KINDS.filter(k => patch[k] !== undefined).map(k => bracketError(k, patch[k]!, t.direction, current)).find(Boolean);
    if (error) { setNotice({ text: error, error: true }); return; }
    setBusy(true); setNotice(null);
    try {
      const res = await fetch(`/api/cfd/trades/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await res.json();
      if (!res.ok || !data.trade) throw new Error(data.error === "invalid_stops" ? "The market moved past this level. Adjust the bracket and confirm again." : data.error === "trade_not_open" ? "This position has already closed." : "Protection was not changed. Check the connection and try again.");
      recordTradeUpdate(data.trade);
      if (mounted.current && draftRef.current?.tradeId === t.id) {
        updateDraft(null); setEditor(false); setNotice({ text: "Position protection updated" });
      }
    } catch (e) { if (mounted.current) setNotice({ text: e instanceof Error ? e.message : "Protection was not changed.", error: true }); }
    finally { if (mounted.current) setBusy(false); }
  }

  if (!positions.length || !selected) return null;
  const axisRight = geometry.axis + 16;
  const activeGeometry = geometry.rows[selected.id];
  const isInChart = (y: number | null | undefined): y is number => y != null && y >= (geometry.width < 600 ? 90 : 65) && y <= geometry.height - 36;
  const orderColor = selected.direction === "UP" ? COLORS.buy : COLORS.sell;
  const pnl = cfdOpenPnl(selected, livePrice);
  const dragEvents = (t: TradeView, kind: BracketKind) => ({ onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => beginDrag(e, t, kind), onPointerMove: moveDrag, onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => endDrag(e), onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => endDrag(e, true), onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
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

  return <div className={styles.root} data-testid="chart-trading" style={{ "--order-color": orderColor } as CSSProperties}>
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
            {active && draft && dirty && !editor && <div className={styles.confirm}>
              <button type="button" onClick={cancel} disabled={busy}>Cancel</button><button type="button" className={styles.primary} onClick={() => void confirm()} disabled={busy || !!validation}>{busy ? "Updating…" : "Confirm"}</button>
            </div>}
            {active && <div className={styles.handles}>
              {BRACKET_KINDS.filter(k => levels[k] == null || draggingKind === t.id + k && savedBrackets(t)[k] == null).map(kind => <button key={kind} type="button" title={`Drag to add ${kind === "takeProfit" ? "Take Profit" : "Stop Loss"}`} aria-label={`Add ${BRACKET_LABEL[kind]} to ${t.direction === "UP" ? "Buy" : "Sell"} position`} disabled={busy} className={`${styles.handle} ${kind === "takeProfit" ? styles.tp : styles.sl}`} {...dragEvents(t, kind)}>{BRACKET_LABEL[kind]}</button>)}
            </div>}
            <div className={styles.position}>
              <button type="button" className={styles.side} aria-label={`Select ${t.direction === "UP" ? "Buy" : "Sell"} ${formatMinor(t.stake, currency)} position`} onClick={() => { if (draft && draft.tradeId !== t.id) return; setSelectedId(t.id); }}>{t.direction === "UP" ? "Buy" : "Sell"} {formatMinor(t.stake, currency)}</button>
              {active && positions.length > 1 && <span className={styles.positionSelect}>
                <select aria-label="Selected chart position" value={selected.id} disabled={!!draft || busy} onChange={e => { setSelectedId(e.target.value); setEditor(false); }}>
                  {positions.map((p,i) => <option key={p.id} value={p.id}>{i + 1}. {p.direction === "UP" ? "Buy" : "Sell"} {formatMinor(p.stake,currency)} @ {p.entryPrice.toFixed(precision)}</option>)}
                </select><span aria-hidden>▾</span>
              </span>}
              <span className={styles.expiry} title="Time until expiry">{countdown(Math.max(0, t.expiryTs - (now ?? t.entryTs)))}</span>
              <button type="button" className={styles.money} onClick={() => editPosition(t)} style={{ color: (cfdOpenPnl(t, livePrice) ?? 0) >= 0 ? "#56bca0" : "#f88089" }}>{money(cfdOpenPnl(t, livePrice), currency)}</button>
              {active && activeGeometry && [activeGeometry.stopLoss,activeGeometry.takeProfit].some(y => y != null && !isInChart(y)) && <button type="button" className={styles.edit} aria-label="Fit position exits" title="Fit position exits" onClick={fitLevels}>↕</button>}
              <button type="button" className={styles.edit} aria-label="Edit position protection" title="Edit position protection" disabled={busy || !!draft && draft.tradeId !== t.id} onClick={() => editPosition(t)}><Edit /></button>
            </div>
          </div>
        </div>}
        {BRACKET_KINDS.map(kind => {
          const level = levels[kind], y = g[kind]; if (level == null || !isInChart(y)) return null;
          const pending = draft?.tradeId === t.id && draft.base[kind] !== level;
          const invalid = pending && bracketError(kind, level, t.direction, livePrice);
          return <div key={kind} className={styles.row} style={{ top: y, "--bracket-color": COLORS[kind] } as CSSProperties}>
            <div className={styles.group} style={{ right: axisRight, opacity: active ? 1 : .6 }}>
              <div className={`${styles.bracket} ${pending ? styles.pending : ""} ${invalid ? styles.invalid : ""} ${busy ? styles.saving : ""}`}>
                <button type="button" className={styles.label} aria-label={`Drag ${BRACKET_LABEL[kind]} level`} title={`${pending ? "Unconfirmed " : ""}${BRACKET_LABEL[kind]} ${level.toFixed(precision)} · drag to modify, double-click to edit`} disabled={busy || !!draft && draft.tradeId !== t.id} {...dragEvents(t, kind)} onDoubleClick={() => editPosition(t)}>{BRACKET_LABEL[kind]}</button>
                <button type="button" className={styles.outcome} aria-label={`${BRACKET_LABEL[kind]} at ${level.toFixed(precision)}`} title={`Price ${level.toFixed(precision)} · ${pending ? "not confirmed" : "active"}`} disabled={busy || !!draft && draft.tradeId !== t.id} {...dragEvents(t, kind)} onDoubleClick={() => editPosition(t)}>{money(bracketPnl(t, level), currency)}</button>
                <button type="button" className={styles.remove} aria-label={`Remove ${BRACKET_LABEL[kind]}`} title={`Remove ${BRACKET_LABEL[kind]}`} disabled={busy || !!draft && draft.tradeId !== t.id} onClick={() => changeLevel(t, kind, null)}><Cross /></button>
              </div>
            </div>
          </div>;
        })}
      </div>;
    })}
    {activeGeometry && !isInChart(activeGeometry.entry) && <button type="button" className={styles.offscreen} style={{ top: 70 }} onClick={fitLevels}>↕ Show position and exits</button>}

    {!editor && draft && dirty && !notice && !validation && <span className="sr-only" role="status">Preview only. Current protection stays active until you confirm.</span>}
    {!editor && (notice || validation) && <div className={styles.notice} role={infoError ? "alert" : "status"} data-error={!!infoError}>
      {infoError ?? notice?.text ?? "Preview · Current protection stays active until you confirm"}
      {!draft && notice && <button type="button" aria-label="Dismiss trading notice" onClick={() => setNotice(null)}><Cross /></button>}
    </div>}
    </div>
    {editor && currentLevels && <section role="dialog" aria-label="Edit position protection" className={styles.editor}>
      <header><strong>{selected.symbol.replace("USDT", "/USDT")}</strong><button type="button" aria-label="Close protection editor" disabled={busy} onClick={() => setEditor(false)}><Cross size={16}/></button></header>
      <div className={styles.editorBody}>
        <p className={styles.summary}>{selected.direction === "UP" ? "Buy" : "Sell"} {formatMinor(selected.stake,currency)} @ {selected.entryPrice.toFixed(precision)}</p>
        <div className={styles.exits}><strong>Exits</strong><span>Risk/reward · {ratio}</span></div>
        {BRACKET_KINDS.map(kind => {
          const value = currentLevels[kind]; const net = value == null ? null : bracketPnl(selected,value);
          return <div key={kind} className={styles.field}>
            <label><input type="checkbox" aria-label={`Enable ${BRACKET_LABEL[kind]}`} checked={value != null} disabled={busy} onChange={e => { setPriceInputs(old => { const next = {...old}; delete next[kind]; return next; }); setMoneyInputs(old => { const next = {...old}; delete next[kind]; return next; }); changeLevel(selected,kind,e.target.checked ? getDefault(selected,kind) : null); }} />{kind === "takeProfit" ? "Take profit" : "Stop loss"}</label>
            <div className={styles.fieldGrid}>
              <label>Price<input aria-label={`${BRACKET_LABEL[kind]} price`} type="number" min={tickSize} step={tickSize} value={priceInputs[kind] ?? value ?? ""} disabled={busy || value == null} onChange={e => {
                const text = e.target.value; setPriceInputs(old => ({ ...old, [kind]: text }));
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
    </section>}
  </div>;
}
