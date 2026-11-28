"use client";
import { useEffect, useRef, useState, type RefObject, type PointerEvent } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type LineData, type UTCTimestamp, type SeriesType } from "lightweight-charts";
import { TIMEFRAME_SEC, type Timeframe } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { DRAWING_TOOLS, INDICATORS, IndicatorAccumulator, readDrawings, type Anchor, type Drawing, type DrawingTool, type Indicator } from "./analysis-model";
import { channelOffset, drawingTimeline, type XY } from "./drawing-coordinates";
import styles from "./ChartAnalysis.module.css";
import { ChartToolIcon } from "./ChartToolIcon";
import { useTheme } from "@/lib/theme";
import { getChartPalette } from "./chart-palette";
import { recordChartMetric } from "./diagnostics";

const NAMES: Record<DrawingTool, string> = {
  select: "Select drawings", horizontal: "Horizontal line", vertical: "Vertical line",
  trend: "Trend line", channel: "Parallel channel", fib: "Fibonacci retracement",
  brush: "Freehand drawing", text: "Text annotation", measure: "Measure",
};
const SINGLE_POINT = ["horizontal", "vertical", "text"];
const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const historyStack = (stack: Drawing[][], snapshot: Drawing[]) => [...stack.slice(-19), snapshot];

type Plot = { width: number; height: number; draftId?: string | undefined; rows: { drawing: Drawing; points: XY[] }[] };
type Gesture = {
  pointerId: number;
  svg: SVGSVGElement;
  start: XY;
} & (
  | { kind: "place" }
  | { kind: "brush"; drawing: Drawing; last: XY }
  | { kind: "edit"; original: Drawing; handle: number | null }
);

export function ChartAnalysis({ chartRef, seriesRef, containerRef, market, chartVersion, scope, symbol, timeframe, focusMode, precision, volumeAvailable, volumeEnabled, onVolumeChange }: {
  chartRef: RefObject<IChartApi | null>; seriesRef: RefObject<ISeriesApi<SeriesType> | null>; containerRef: RefObject<HTMLDivElement | null>;
  market: MarketStore; chartVersion: number; scope: string; symbol: string; timeframe: Timeframe; focusMode: boolean; precision: number;
  volumeAvailable: boolean; volumeEnabled: boolean; onVolumeChange: () => void;
}) {
  const theme = useTheme();
  const indicatorSeries = useRef<{kind: Indicator; series: ISeriesApi<"Line">}[]>([]);
  const storageKey = `asm_chart_drawings:v1:${scope}`;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const drawingsRef = useRef<Drawing[]>([]);
  const undo = useRef<Drawing[][]>([]);
  const redo = useRef<Drawing[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>("select");
  const [text, setText] = useState("Note");
  const [editedText, setEditedText] = useState<string | null>(null);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [menu, setMenu] = useState(false);
  const [indicatorReadout, setIndicatorReadout] = useState("");
  const [view, setView] = useState<Plot>({ width: 0, height: 0, rows: [] });
  const [notice, setNotice] = useState("");
  const annotationRef = useRef<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const placement = useRef<Drawing | null>(null);
  const preview = useRef<Drawing | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const scheduleRef = useRef(() => {});

  useEffect(() => {
    try {
      const saved = readDrawings(localStorage.getItem(storageKey));
      drawingsRef.current = saved;
      setDrawings(saved);
      const indicatorPrefs = JSON.parse(localStorage.getItem(`asm_chart_indicators:${scope}`) ?? "[]");
      if (Array.isArray(indicatorPrefs)) setIndicators(INDICATORS.filter(i => indicatorPrefs.includes(i)));
    } catch { /* Optional storage. */ }
  }, [storageKey, scope]);

  function restore(next: Drawing[]) {
    drawingsRef.current = next;
    setDrawings(next);
    scheduleRef.current();
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setNotice("Drawing saved for this visit. Browser storage is unavailable."); }
  }

  function save(next: Drawing[]) {
    undo.current = historyStack(undo.current, drawingsRef.current);
    redo.current = [];
    restore(next);
  }

  function setPreview(next: Drawing | null) {
    if (preview.current === next) return;
    preview.current = next;
    scheduleRef.current();
  }

  function clearGesture() {
    const active = gesture.current;
    gesture.current = null;
    if (active?.svg.hasPointerCapture(active.pointerId)) active.svg.releasePointerCapture(active.pointerId);
    placement.current = null;
    setPreview(null);
  }

  function cancel() {
    clearGesture();
    setTool("select");
    setNotice("");
  }

  const current = drawings.find(d => d.id === selected);
  function finishText(value = editedText) {
    if (value === null) return;
    setEditedText(null);
    const original = drawingsRef.current.find(d => d.id === selected);
    if (original?.tool !== "text") return;
    const next = value.trim() || "Note";
    if (next === (original.text ?? "Note")) return;
    save(drawingsRef.current.map(d => d === original ? { ...d, text: next } : d));
  }

  function history(direction: "undo" | "redo") {
    cancel();
    setEditedText(null);
    const from = direction === "undo" ? undo : redo;
    const to = direction === "undo" ? redo : undo;
    const snapshot = from.current.pop();
    if (!snapshot) return;
    to.current = historyStack(to.current, drawingsRef.current);
    if (!snapshot.some(d => d.id === selected)) setSelected(null);
    restore(snapshot);
  }

  function deleteSelected() {
    const previous = drawingsRef.current;
    const next = previous.filter(d => d.id !== selected);
    if (next.length === previous.length) return;
    cancel();
    setEditedText(null);
    setSelected(null);
    save(next);
  }

  useEffect(() => {
    // Viewport changes preserve saved market anchors and discard in-progress gestures.
    clearGesture();
    setTool("select");
    setNotice("");
  }, [timeframe, focusMode]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]"))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.key === "Escape") {
        if (tool === "select" && !gesture.current && !current && !menu) return;
        e.preventDefault();
        cancel();
        setSelected(null);
        setMenu(false);
      } else if ((e.key === "Delete" || e.key === "Backspace") && current) {
        e.preventDefault();
        deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        const direction = key === "y" || e.shiftKey ? "redo" : "undo";
        if ((direction === "undo" ? undo : redo).current.length === 0) return;
        e.preventDefault();
        history(direction);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  useEffect(() => {
    const chart = chartRef.current, el = containerRef.current, svg = svgRef.current;
    const pane = chart?.panes()[0];
    if (!chart || !el || !svg || !pane) return;

    let frame = 0;
    let previous: Plot | undefined;
    const draw = () => {
      frame = 0;
      const { width, height } = chart.paneSize();
      const draft = preview.current;
      const saved = drawingsRef.current;
      const items = draft ? [...saved.filter(d => d.id !== draft.id), draft] : saved;
      const state = market.getSnapshot().chart;
      const series = seriesRef.current;
      const timeline = items.length && state.symbol === symbol && state.timeframe === timeframe
        ? drawingTimeline(chart.timeScale(), TIMEFRAME_SEC[timeframe]) : null;
      if (!timeline || !series) {
        if (!previous || previous.width !== width || previous.height !== height || previous.rows.length) {
          previous = { width, height, rows: [] };
          setView(previous);
        }
        return;
      }

      const started = performance.now();
      const rows: Plot["rows"] = [];
      let changed = !previous || previous.width !== width || previous.height !== height || previous.draftId !== draft?.id;
      for (const drawing of items) {
        const points: XY[] = [];
        for (const anchor of drawing.points) {
          const x = timeline.xAtTime(anchor.time);
          const y = series.priceToCoordinate(anchor.price);
          if (!Number.isFinite(x) || y === null || !Number.isFinite(y)) break;
          points.push({ x, y });
        }
        if (points.length !== drawing.points.length) continue;
        const old = previous?.rows[rows.length];
        if (old?.drawing === drawing && points.every((p, i) => p.x === old.points[i]?.x && p.y === old.points[i]?.y)) rows.push(old);
        else {
          changed = true;
          rows.push({ drawing, points });
        }
      }
      if (changed || rows.length !== previous?.rows.length) {
        previous = { width, height, draftId: draft?.id, rows };
        setView(previous);
      }
      recordChartMetric("chartWork", performance.now() - started);
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
    };
    scheduleRef.current = schedule;
    // The pane invalidates this hook for native zoom/pan, autoscaling, and new market data.
    const invalidation = { updateAllViews: schedule };
    pane.attachPrimitive(invalidation);
    const deselect = () => {
      annotationRef.current?.blur();
      setSelected(null);
    };
    const wheel = (e: WheelEvent) => {
      const forwarded = new WheelEvent("wheel", {
        clientX: e.clientX, clientY: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY,
        deltaMode: e.deltaMode, cancelable: true,
      });
      if (!chart.chartElement().dispatchEvent(forwarded)) e.preventDefault();
    };
    document.addEventListener("visibilitychange", schedule);
    el.addEventListener("pointerdown", deselect);
    svg.addEventListener("wheel", wheel, { passive: false });
    schedule();
    return () => {
      scheduleRef.current = () => {};
      cancelAnimationFrame(frame);
      if (chartRef.current === chart) pane.detachPrimitive(invalidation);
      document.removeEventListener("visibilitychange", schedule);
      el.removeEventListener("pointerdown", deselect);
      svg.removeEventListener("wheel", wheel);
    };
  }, [chartVersion, market, scope, symbol, timeframe]);
  useEffect(() => {
    const chart=chartRef.current;
    if (!chart) return;
    // Discard hover indexes before replacing indicator series and their shared timeline.
    chart.clearCrosshairPosition();
    const palette = getChartPalette();
    const rows=indicators.map(kind=>({kind,series:chart.addSeries(LineSeries,{color:palette[kind],lineWidth:1,title:`${kind} 14`,priceLineVisible:false,lastValueVisible:true, ...(kind === "RSI" ? {priceScaleId:"right"} : {})},kind === "RSI" ? 1 : 0),acc:new IndicatorAccumulator(kind),first:0,closed:0,seeded:false,latest:null as number | null}));
    indicatorSeries.current = rows;
    let raf=0;
    const update=()=>{
      raf=0;const state=market.getSnapshot().chart;
      if(state.symbol!==symbol || state.candles.length===0)return;
      for(const row of rows){
        const first=state.candles[0]!.openTs;
        if(!row.seeded || first<row.first || state.candles.at(-1)!.openTs<row.closed){
          row.acc=new IndicatorAccumulator(row.kind);const data:LineData[]=[];
          for(const c of state.candles){const value=row.acc.update(c.openTs,c.c);if(value!==null)data.push({time:c.openTs as UTCTimestamp,value});}
          row.series.setData(data);row.latest=data.at(-1)?.value??null;row.seeded=true;row.closed=state.candles.at(-1)!.openTs;
        } else {
          // Only revise/append bars at the accumulator's tail; no history reload per tick.
          for(let i=state.candles.length-1;i>=0;i--){if(state.candles[i]!.openTs<row.closed){
            for(const c of state.candles.slice(i+1)){const value=row.acc.update(c.openTs,c.c);if(value!==null){row.latest=value;row.series.update({time:c.openTs as UTCTimestamp,value});}}break;}
          }
          row.closed=state.candles.at(-1)!.openTs;
        }
        row.first=first;
        if(state.forming && state.forming.openTs>=row.acc.lastTime){const value=row.acc.update(state.forming.openTs,state.forming.c);if(value!==null){row.latest=value;row.series.update({time:state.forming.openTs as UTCTimestamp,value});}}
      }
      const readout=rows.map(row=>`${row.kind} 14: ${row.latest?.toFixed(row.kind=== "RSI"?2:precision)??"Waiting for candles"}`).join(" · ");
      setIndicatorReadout(old=>old===readout?old:readout);
    };
    const schedule=()=>{if(!raf && !document.hidden)raf=requestAnimationFrame(update);};
    const unsub=market.subscribe(schedule);schedule();
    return()=>{
      indicatorSeries.current=[];unsub();cancelAnimationFrame(raf);
      // A removed chart takes its series with it; touching it would queue a redraw that throws "Object is disposed".
      if(chartRef.current!==chart)return;
      try{chart.clearCrosshairPosition();}catch{/* Chart may already be removed. */}for(const row of rows){try{chart.removeSeries(row.series);}catch{/* Chart may already be removed. */}}
    };
  }, [chartVersion, market, symbol, indicators.join(",")]);

  useEffect(()=>{const palette=getChartPalette();for(const row of indicatorSeries.current)row.series.applyOptions({color:palette[row.kind]});},[theme]);


  function projection() {
    const state = market.getSnapshot().chart;
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || state.symbol !== symbol || state.timeframe !== timeframe) return null;
    const timeline = drawingTimeline(chart.timeScale(), TIMEFRAME_SEC[timeframe]);
    if (!timeline) return null;
    return {
      toAnchor(p: XY): Anchor | null {
        const time = timeline.timeAtX(p.x);
        const price = series.coordinateToPrice(p.y);
        return Number.isFinite(time) && time > 0 && price !== null && Number.isFinite(price) && price > 0 ? { time, price } : null;
      },
      toScreen(anchor: Anchor): XY | null {
        const x = timeline.xAtTime(anchor.time), y = series.priceToCoordinate(anchor.price);
        return Number.isFinite(x) && y !== null && Number.isFinite(y) ? { x, y } : null;
      },
    };
  }

  function eventPoint(e: PointerEvent<SVGSVGElement>): XY {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  function inside(p: XY) {
    return p.x >= 0 && p.y >= 0 && p.x <= view.width && p.y <= view.height;
  }

  function editedDrawing(g: Extract<Gesture, { kind: "edit" }>, point: XY): Drawing {
    const { original, handle, start } = g;
    const dx = original.tool === "horizontal" ? 0 : point.x - start.x;
    const dy = original.tool === "vertical" ? 0 : point.y - start.y;
    if (Math.hypot(dx, dy) < 2) return original;
    const coordinates = projection();
    if (!coordinates) return original;
    const points: Anchor[] = [];
    for (const [i, anchor] of original.points.entries()) {
      if (handle !== null && handle !== i) {
        points.push(anchor);
        continue;
      }
      const p = coordinates.toScreen(anchor);
      const moved = p && coordinates.toAnchor({ x: p.x + dx, y: p.y + dy });
      if (!moved) return original;
      points.push({ time: dx ? moved.time : anchor.time, price: dy ? moved.price : anchor.price });
    }
    if (original.tool === "channel" && (handle === 0 || handle === 1) && points[0] && points[1]) {
      const a = coordinates.toScreen(points[0]), b = coordinates.toScreen(points[1]);
      if (a && b && distance(a, b) < 2) return original;
    }
    return { ...original, points };
  }

  function placeAnchor(point: XY) {
    if (tool === "select" || tool === "brush") return;
    const coordinates = projection();
    if (!coordinates) return;
    const anchor = coordinates.toAnchor(point);
    if (!anchor) return;
    const pending = placement.current;
    if (!pending) {
      const drawing: Drawing = {
        id: crypto.randomUUID(), tool, points: [anchor],
        ...(tool === "text" ? { text: text.trim() || "Note" } : {}),
      };
      if (SINGLE_POINT.includes(tool)) complete(drawing);
      else {
        placement.current = drawing;
        setPreview(drawing);
        setNotice("Click the second point. Esc cancels.");
      }
      return;
    }

    const a = coordinates.toScreen(pending.points[0]!);
    if (!a) return;
    const drawing = { ...pending, points: [...pending.points, anchor] };
    if (pending.points.length === 1) {
      if (distance(a, point) < 2) return;
      if (tool === "channel") {
        placement.current = drawing;
        setPreview(drawing);
        setNotice("Click to set the channel width. Esc cancels.");
        return;
      }
    } else {
      const b = coordinates.toScreen(pending.points[1]!);
      if (!b) return;
      const length = distance(a, b);
      if (length < 2 || Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length < 2) return;
    }
    complete(drawing);
  }

  function complete(drawing: Drawing) {
    const original = drawingsRef.current.find(d => d.id === drawing.id);
    cancel();
    if (drawing !== original) {
      save(original ? drawingsRef.current.map(d => d === original ? drawing : d) : [...drawingsRef.current, drawing]);
    }
    setSelected(drawing.id);
  }

  function begin(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || !e.isPrimary || gesture.current) return;
    annotationRef.current?.blur();
    const start = eventPoint(e);
    const base = { pointerId: e.pointerId, svg: e.currentTarget, start };
    if (tool === "select") {
      const target = (e.target as SVGElement).closest("[data-drawing]");
      const id = target?.getAttribute("data-drawing");
      const original = drawingsRef.current.find(d => d.id === id);
      setSelected(original?.id ?? null);
      if (!original) return;
      const index = target?.getAttribute("data-anchor");
      gesture.current = { ...base, kind: "edit", original, handle: index == null ? null : Number(index) };
    } else {
      if (drawingsRef.current.length >= 64) {
        setNotice("Remove a drawing before adding more (64 maximum).");
        return;
      }
      if (!inside(start)) return;
      if (tool === "brush") {
        const anchor = projection()?.toAnchor(start);
        if (!anchor) return;
        gesture.current = {
          ...base, kind: "brush", last: start,
          drawing: { id: crypto.randomUUID(), tool, points: [anchor] },
        };
      } else gesture.current = { ...base, kind: "place" };
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function sampleBrush(g: Extract<Gesture, { kind: "brush" }>, point: XY) {
    const anchor = projection()?.toAnchor(point);
    if (!anchor) return;
    const points = g.drawing.points;
    g.drawing = { ...g.drawing, points: [...points.slice(0, 255), anchor] };
    g.last = point;
    setPreview(g.drawing);
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!e.isPrimary || (g && g.pointerId !== e.pointerId)) return;
    const point = eventPoint(e);
    if (g?.kind === "edit") {
      const drawing = editedDrawing(g, point);
      setPreview(drawing === g.original ? null : drawing);
    } else if (g?.kind === "brush") {
      if (distance(g.last, point) >= 2) sampleBrush(g, point);
    } else if (placement.current && inside(point)) {
      const anchor = projection()?.toAnchor(point);
      if (anchor) setPreview({ ...placement.current, points: [...placement.current.points, anchor] });
    }
  }

  function finish(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const point = eventPoint(e);
    if (g.kind === "place") {
      if (inside(point) && distance(g.start, point) < 5) placeAnchor(point);
    } else if (g.kind === "edit") {
      if (drawingsRef.current.includes(g.original)) complete(editedDrawing(g, point));
      else clearGesture();
    } else {
      if (distance(g.last, point) >= 2) sampleBrush(g, point);
      if (g.drawing.points.length > 1) complete(g.drawing);
      else setPreview(null);
    }
  }

  function interrupted(e: PointerEvent<SVGSVGElement>) {
    if (gesture.current?.pointerId === e.pointerId) cancel();
  }

  function choose(next: DrawingTool) {
    finishText();
    clearGesture();
    setSelected(null);
    setTool(next);
    if (next === "select") setNotice("");
    else if (next === "brush") setNotice("Drag to draw. Esc cancels.");
    else setNotice(SINGLE_POINT.includes(next) ? "Click to place. Esc cancels." : "Click the first point. Esc cancels.");
  }

  function zoom(factor: number) {
    const scale = chartRef.current?.timeScale(), range = scale?.getVisibleLogicalRange();
    if (!range || !scale) return;
    const middle = (range.from + range.to) / 2, half = (range.to - range.from) * factor / 2;
    scale.setVisibleLogicalRange({ from: middle - half, to: middle + half });
  }

  function toggleIndicator(kind: Indicator) {
    const next = indicators.includes(kind) ? indicators.filter(i => i !== kind) : [...indicators, kind];
    setIndicators(next);
    try { localStorage.setItem(`asm_chart_indicators:${scope}`, JSON.stringify(next)); } catch { /* Optional storage. */ }
  }

  const indicatorCount = indicators.length + Number(volumeEnabled);
  const active = view.rows.find(({ drawing }) => drawing.id === selected);

  return <>
    <nav aria-label="Chart drawing tools" className={styles.rail}>
      {DRAWING_TOOLS.map(t => <button key={t} type="button" title={NAMES[t]} aria-label={NAMES[t]} aria-pressed={tool === t} onClick={() => choose(t)}><ChartToolIcon name={t} /></button>)}
      <span className={styles.divider} />
      <button type="button" aria-label="Zoom in chart" title="Zoom in" onClick={() => zoom(.75)}><ChartToolIcon name="zoomIn" /></button>
      <button type="button" aria-label="Zoom out chart" title="Zoom out" onClick={() => zoom(1.3)}><ChartToolIcon name="zoomOut" /></button>
      <button type="button" aria-label="Fit chart" title="Fit chart" onClick={() => chartRef.current?.timeScale().fitContent()}><ChartToolIcon name="fit" /></button>
      <button type="button" aria-label="Undo drawing change" title="Undo" disabled={!undo.current.length} onClick={() => history("undo")}><ChartToolIcon name="undo" /></button>
      <button type="button" aria-label="Redo drawing change" title="Redo" disabled={!redo.current.length} onClick={() => history("redo")}><ChartToolIcon name="redo" /></button>
      <button type="button" aria-label="Delete selected drawing" title="Delete selected drawing" disabled={!current} onClick={deleteSelected}><ChartToolIcon name="delete" /></button>
    </nav>
    <div className={styles.indicators}>
      <button type="button" aria-expanded={menu} onClick={() => setMenu(v => !v)}>ƒx <span>Indicators</span>{indicatorCount > 0 ? ` · ${indicatorCount}` : ""}</button>
      {menu && <div className={styles.menu}>{INDICATORS.map(i => <label key={i}><input type="checkbox" checked={indicators.includes(i)} onChange={() => toggleIndicator(i)} /><span style={{ color: `var(--color-chart-${i.toLowerCase()})` }}>{i} 14</span></label>)}{volumeAvailable && <label><input type="checkbox" checked={volumeEnabled} onChange={onVolumeChange} /><span>Volume</span></label>}<output data-testid="indicator-values" className="text-[10px] text-ink-2">{indicatorReadout}</output><button type="button" onClick={() => setMenu(false)}>Done</button></div>}
    </div>
    {(tool === "text" || current?.tool === "text") && (
      <div className={styles.annotation}>
        <input
          ref={annotationRef}
          aria-label="Annotation text"
          maxLength={120}
          value={current?.tool === "text" ? editedText ?? current.text ?? "Note" : text}
          onChange={e => current?.tool === "text" ? setEditedText(e.target.value) : setText(e.target.value)}
          onBlur={() => finishText()}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              setEditedText(null);
              if (tool === "text") cancel();
            }
          }}
        />
      </div>
    )}
    {notice && <button type="button" className={styles.notice} onClick={() => setNotice("")} aria-label="Dismiss chart hint">{notice} ×</button>}
    <svg
      ref={svgRef}
      className={styles.canvas}
      width={view.width}
      height={view.height}
      data-chart-editing={tool !== "select" || !!view.draftId}
      aria-label="Chart drawings"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={interrupted}
      onLostPointerCapture={interrupted}
      onPointerLeave={() => { if (!gesture.current && placement.current) setPreview(placement.current); }}
      onContextMenu={e => { if (tool !== "select" || gesture.current) { e.preventDefault(); cancel(); } }}
    >
      {view.rows.map(({ drawing: d, points }) => {
        const [a, b, c] = points;
        if (!a) return null;
        const selectedRow = d.id === selected;
        const placing = tool !== "select" && d.id === view.draftId;
        const color = selectedRow || placing ? "var(--color-chart-drawing-active)" : "var(--color-chart-drawing)";
        const stroke = selectedRow ? 2 : 1.5;
        function line(start: XY, end: XY) {
          const coords = { x1: start.x, x2: end.x, y1: start.y, y2: end.y };
          return <>
            <line {...coords} data-drawing-line="" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
            <line {...coords} className={styles.hit} stroke="transparent" strokeWidth="14" strokeLinecap="round" />
          </>;
        }
        let content;
        if (d.tool === "horizontal") content = <>
          {line({ x: 0, y: a.y }, { x: view.width, y: a.y })}
          <text x={view.width - 6} y={a.y - 5} textAnchor="end" fill={color} fontSize="11">{d.points[0]!.price.toFixed(precision)}</text>
        </>;
        else if (d.tool === "vertical") content = line({ x: a.x, y: 0 }, { x: a.x, y: view.height });
        else if (d.tool === "text") content = <text className={styles.textHit} fill={color} x={a.x} y={a.y} fontSize="14">{selectedRow ? editedText || d.text || "Note" : d.text || "Note"}</text>;
        else if (d.tool === "brush") {
          const trace = points.map(p => `${p.x},${p.y}`).join(" ");
          content = <>
            <polyline points={trace} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={trace} className={styles.hit} stroke="transparent" strokeWidth="14" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>;
        } else if (!b) content = <circle cx={a.x} cy={a.y} r="3" fill={color} />;
        else if (d.tool === "fib") content = [0, .236, .382, .5, .618, .786, 1].map(level => {
          const y = a.y + (b.y - a.y) * level;
          const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
          const price = d.points[0]!.price + (d.points[1]!.price - d.points[0]!.price) * level;
          return <g key={level}>{line({ x: left, y }, { x: right, y })}<text x={right + 4} y={y + 3} fill={color} fontSize="10">{level} · {price.toFixed(precision)}</text></g>;
        });
        else if (d.tool === "channel" && (c || !placing)) {
          const offset = channelOffset(a, b, c);
          const otherA = { x: a.x + offset.x, y: a.y + offset.y };
          const otherB = { x: b.x + offset.x, y: b.y + offset.y };
          content = <>
            <polygon className={styles.areaHit} points={[a, b, otherB, otherA].map(p => `${p.x},${p.y}`).join(" ")} fill="var(--color-chart-drawing-fill)" />
            {line(a, b)}
            {line(otherA, otherB)}
          </>;
        } else content = <>
          {d.tool === "measure" && <>
            <rect className={styles.areaHit} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="var(--color-chart-drawing-fill)" />
            <text x={b.x + 5} y={b.y - 8} fill={color} fontSize="11">{((d.points[1]!.price / d.points[0]!.price - 1) * 100).toFixed(2)}% · {Math.round(Math.abs(d.points[1]!.time - d.points[0]!.time) / 60)}m</text>
          </>}
          {line(a, b)}
        </>;
        return <g key={d.id} data-drawing={d.id} data-tool={d.tool} data-preview={placing || undefined}>{content}</g>;
      })}
      {active && active.drawing.tool !== "brush" && active.points.map((p, i) => (
        <circle key={i} className={styles.handle} data-drawing={active.drawing.id} data-anchor={i} cx={p.x} cy={p.y} r="6" fill="var(--color-chart-handle)" stroke="var(--color-chart-drawing-active)" strokeWidth="2" />
      ))}
      {tool !== "select" && <rect className={styles.capture} width={view.width} height={view.height} fill="transparent" />}
    </svg>
  </>;
}
