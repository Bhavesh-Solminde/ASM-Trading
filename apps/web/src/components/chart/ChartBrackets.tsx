"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { AutoscaleInfo, IChartApi, ISeriesApi } from "lightweight-charts";
import type { TradeView } from "@asm/contracts";
import { usePlatform, useQuote } from "@/components/shell/PlatformProvider";
import { cfdOpenPnl } from "@/components/trade/pnl-display";
import { formatMinor } from "@/lib/format-money";

type Level = "stopLoss" | "takeProfit";
type Levels = Record<Level, number | null>;
const name = { stopLoss: "SL", takeProfit: "TP" } as const;

export function ChartBrackets({ trades, seriesRef, chartRef, containerRef, precision, currency, chartVersion, onEditingId }: {
  trades: TradeView[];
  seriesRef: RefObject<ISeriesApi<any> | null>;
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  precision: number;
  currency: string;
  chartVersion: number;
  onEditingId: (id: string | null) => void;
}) {
  const positions = trades.filter(t => t.durationSec != null);
  const [selected, setSelected] = useState("");
  const trade = positions.find(t => t.id === selected) ?? positions[0];
  const [editing, setEditing] = useState(false);
  const [levels, setLevels] = useState<Levels>({ stopLoss: null, takeProfit: null });
  const [pick, setPick] = useState<Level | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fit, setFit] = useState(false);
  const [ys, setYs] = useState<Record<Level, number | null>>({ stopLoss: null, takeProfit: null });
  const drag = useRef<Level | null>(null);
  const price = useQuote(trade?.symbol ?? "")?.price ?? trade?.entryPrice ?? 0;
  const { recordTradeUpdate } = usePlatform();
  const saved = { stopLoss: trade?.stopLoss ?? null, takeProfit: trade?.takeProfit ?? null };
  const shown = editing ? levels : saved;

  useEffect(() => {
    setLevels({ stopLoss: trade?.stopLoss ?? null, takeProfit: trade?.takeProfit ?? null });
    if (!trade || (selected && trade.id !== selected)) setEditing(false);
    setPick(null); setError(""); setFit(false);
  }, [trade?.id, selected]);
  useEffect(() => { onEditingId(editing ? trade?.id ?? null : null); return () => onEditingId(null); }, [editing, trade?.id, onEditingId]);

  useEffect(() => {
    const update = () => {
      const series = seriesRef.current;
      const next = { stopLoss: shown.stopLoss == null ? null : series?.priceToCoordinate(shown.stopLoss) ?? null,
        takeProfit: shown.takeProfit == null ? null : series?.priceToCoordinate(shown.takeProfit) ?? null };
      setYs(old => old.stopLoss === next.stopLoss && old.takeProfit === next.takeProfit ? old : next);
    };
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [shown.stopLoss, shown.takeProfit, seriesRef, chartVersion]);

  useEffect(() => {
    if (!fit) return;
    const series = seriesRef.current;
    if (!series) return;
    const original = series.options().autoscaleInfoProvider;
    const prices = [shown.stopLoss, shown.takeProfit, trade?.entryPrice].filter((p): p is number => p != null);
    series.applyOptions({ autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const info = base();
      if (!info?.priceRange) return info;
      const min = Math.min(info.priceRange.minValue, ...prices);
      const max = Math.max(info.priceRange.maxValue, ...prices);
      const pad = Math.max((max - min) * .08, 10 ** -precision);
      return { ...info, priceRange: { minValue: min - pad, maxValue: max + pad } };
    } });
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    return () => { series.applyOptions({ autoscaleInfoProvider: original }); };
  }, [fit, shown.stopLoss, shown.takeProfit, trade?.entryPrice, chartVersion, seriesRef, chartRef, precision]);

  function begin() {
    setSelected(trade!.id);
    setLevels(saved);
    setEditing(true);
    setError("");
  }
  function setLevel(key: Level, value: number | null) {
    setLevels(old => ({ ...old, [key]: value }));
    setError("");
  }
  function fromY(key: Level, clientY: number) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const p = seriesRef.current?.coordinateToPrice(clientY - bounds.top);
    if (p != null && Number.isFinite(p) && p > 0) setLevel(key, Number(p.toFixed(precision)));
  }
  async function save() {
    if (!trade) return;
    const buy = trade.direction === "UP";
    if ((levels.stopLoss != null && (levels.stopLoss <= 0 || (buy ? levels.stopLoss >= price : levels.stopLoss <= price))) ||
        (levels.takeProfit != null && (levels.takeProfit <= 0 || (buy ? levels.takeProfit <= price : levels.takeProfit >= price)))) {
      setError(buy ? "Buy: SL must be below the current price; TP above it." : "Sell: SL must be above the current price; TP below it.");
      return;
    }
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/cfd/trades/${trade.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(levels) });
      const data = await res.json();
      if (!res.ok || !data.trade) throw new Error(data.error === "invalid_stops" ? "Price moved past this level. Adjust it and save again." : data.error === "trade_not_open" ? "This trade has already closed." : "Could not save protection. Try again.");
      recordTradeUpdate(data.trade);
      setEditing(false); setPick(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save protection."); }
    finally { setBusy(false); }
  }
  if (!trade) return null;
  const height = containerRef.current?.clientHeight ?? 400;
  return <>
    {pick && <div role="button" aria-label={`Place ${name[pick]} on chart`} className="absolute inset-0 z-20 cursor-crosshair touch-none"
      onPointerDown={e => { fromY(pick, e.clientY); setPick(null); }} />}
    {(["stopLoss", "takeProfit"] as Level[]).map(key => {
      const level = shown[key]; const y = ys[key];
      if (level == null || y == null) return null;
      const offscreen = y < 0 || y > height - 24;
      const top = Math.max(0, Math.min(height - 24, y));
      const pnl = cfdOpenPnl(trade, level) ?? 0;
      return <div key={key} className="pointer-events-none absolute left-0 right-0 z-20" style={{ top }}>
        {!offscreen && <div className={`absolute left-0 right-[65px] border-t border-dashed ${key === "stopLoss" ? "border-down" : "border-up"}`} />}
        <button type="button" aria-label={`Drag ${name[key]} level`} disabled={busy}
          className={`pointer-events-auto absolute ${editing ? "left-3" : "right-[75px]"} -translate-y-1/2 touch-none select-none rounded border bg-panel px-2 py-1 text-[11px] font-bold tabular-nums shadow-lg ${key === "stopLoss" ? "border-down text-down" : "border-up text-up"} ${editing ? "cursor-ns-resize" : "cursor-pointer"}`}
          onPointerDown={e => { if (!editing) { begin(); return; } e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = key; setFit(false); }}
          onPointerMove={e => { if (drag.current === key) fromY(key, e.clientY); }}
          onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { drag.current = null; }}>
          {name[key]} {level.toFixed(precision)} · {pnl > 0 ? "+" : pnl < 0 ? "−" : ""}{formatMinor(Math.abs(pnl), currency)} {offscreen ? (y < 0 ? "↑ off chart" : "↓ off chart") : ""}
        </button>
      </div>;
    })}
    <div className="absolute right-[70px] top-[52px] z-30 max-w-[calc(100%-80px)] text-xs">
      {!editing ? <button type="button" onClick={begin} className="rounded-lg border border-rule bg-panel px-3 py-2 font-bold text-ink">SL / TP</button> :
        <div className="w-[270px] max-w-full rounded-xl border border-rule bg-panel/95 p-3 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between"><strong>Protect trade</strong><button type="button" aria-label="Cancel protection changes" onClick={() => { setEditing(false); setPick(null); setError(""); }} disabled={busy}>✕</button></div>
          <select aria-label="Trade to protect" className="mb-2 w-full rounded border border-rule bg-tile p-1 text-ink" value={trade.id} disabled={busy} onChange={e => { const t = positions.find(t => t.id === e.target.value)!; setSelected(t.id); setLevels({ stopLoss: t.stopLoss ?? null, takeProfit: t.takeProfit ?? null }); }}>
            {positions.map(t => <option key={t.id} value={t.id}>{t.direction === "UP" ? "Buy" : "Sell"} {formatMinor(t.stake, currency)} @ {t.entryPrice.toFixed(precision)}</option>)}
          </select>
          {(["stopLoss", "takeProfit"] as Level[]).map(key => <div key={key} className="mb-2">
            <label className={key === "stopLoss" ? "text-down" : "text-up"} htmlFor={`chart-${key}`}>{key === "stopLoss" ? "Stop Loss" : "Take Profit"} price</label>
            <div className="mt-1 flex gap-1">
              <input id={`chart-${key}`} aria-label={`${name[key]} price`} type="number" step={10 ** -precision} min={10 ** -precision} disabled={busy} value={levels[key] ?? ""} placeholder="Not set" onChange={e => setLevel(key, e.target.value === "" ? null : Number(e.target.value))} className="w-0 min-w-0 flex-1 rounded border border-rule bg-tile p-1.5 text-ink" />
              <button type="button" aria-label={`Place ${name[key]} on chart`} disabled={busy} onClick={() => setPick(key)} className={`rounded border px-2 ${pick === key ? "border-brand text-brand" : "border-rule"}`}>⌖</button>
              <button type="button" aria-label={`Remove ${name[key]}`} disabled={busy} onClick={() => setLevel(key, null)} className="px-1">✕</button>
            </div>
          </div>)}
          <p className="mb-2 text-[10px] text-ink-2">{pick ? `Tap the chart to place ${name[pick]}.` : "Place a level on the chart, then drag its label. Changes apply only when saved."}</p>
          {error && <p role="alert" className="mb-2 text-down">{error}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => setFit(true)} className="rounded border border-rule px-2 py-2">Fit levels</button><button type="button" onClick={() => void save()} disabled={busy || pick != null} className="flex-1 rounded bg-up px-2 py-2 font-bold text-up-ink disabled:opacity-50">{busy ? "Saving…" : "Save SL / TP"}</button></div>
        </div>}
    </div>
  </>;
}
