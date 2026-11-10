"use client";
import { useEffect, useRef, useState, type RefObject, type PointerEvent } from "react";
import { LineSeries, type IChartApi, type ISeriesApi, type LineData, type UTCTimestamp, type Logical, type SeriesType } from "lightweight-charts";
import { TIMEFRAME_SEC } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { DRAWING_TOOLS, INDICATORS, IndicatorAccumulator, readDrawings, type Anchor, type Drawing, type DrawingTool, type Indicator } from "./analysis-model";
import styles from "./ChartAnalysis.module.css";
import { ChartToolIcon } from "./ChartToolIcon";

type XY = { x: number; y: number };
const NAMES: Record<DrawingTool, string> = { select: "Select drawings", horizontal: "Horizontal line", trend: "Trend line", channel: "Parallel channel", fib: "Fibonacci retracement", brush: "Freehand drawing", text: "Text annotation", measure: "Measure" };
const COLORS = { SMA: "#f5bd4f", EMA: "#ae91ff", RSI: "#5dc8ff" };

export function ChartAnalysis({ chartRef, seriesRef, containerRef, market, chartVersion, scope, symbol, precision }: {
  chartRef: RefObject<IChartApi | null>; seriesRef: RefObject<ISeriesApi<SeriesType> | null>; containerRef: RefObject<HTMLDivElement | null>;
  market: MarketStore; chartVersion: number; scope: string; symbol: string; precision: number;
}) {
  const storageKey = `asm_chart_drawings:v1:${scope}`;
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>("select");
  const [text, setText] = useState("Note");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [menu, setMenu] = useState(false);
  const [indicatorReadout, setIndicatorReadout] = useState("");
  const [view, setView] = useState<{ width: number; height: number; rows: { drawing: Drawing; points: XY[] }[] }>({ width: 0, height: 0, rows: [] });
  const [notice, setNotice] = useState("");
  const drawingsRef = useRef(drawings); drawingsRef.current = drawings;
  const draftRef = useRef(draft); draftRef.current = draft;
  const gesture = useRef<{ index: number | null; editing: boolean } | null>(null);
  const undo = useRef<Drawing[][]>([]);
  const frame = useRef(0);
  const moveFrame = useRef(0);
  const scheduleRef = useRef(() => {});
  useEffect(() => {
    try {
      setDrawings(readDrawings(localStorage.getItem(storageKey)));
      const saved = JSON.parse(localStorage.getItem(`asm_chart_indicators:${scope}`) ?? "[]");
      if (Array.isArray(saved)) setIndicators(INDICATORS.filter(i => saved.includes(i)));
    } catch { /* Optional storage. */ }
  }, [storageKey, scope]);
  function save(next: Drawing[]) {
    undo.current = [...undo.current.slice(-19), drawingsRef.current];
    drawingsRef.current = next; setDrawings(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setNotice("Drawing saved for this visit; browser storage is unavailable."); }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input, textarea, select")) return;
      if (e.key === "Escape") { gesture.current = null; draftRef.current = null; setDraft(null); setTool("select"); setMenu(false); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); save(drawingsRef.current.filter(d => d.id !== selected)); setSelected(null); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, storageKey]);

  function screenPoint(p: Anchor): XY | null {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const state = market.getSnapshot().chart;
    if (state.symbol !== symbol || state.candles.length === 0) return null;
    const exact = chart.timeScale().timeToCoordinate(p.time as UTCTimestamp);
    let x: number | null = exact;
    if (x == null) {
      const bars = state.candles;
      let lo=0, hi=bars.length;
      while (lo<hi) { const mid=(lo+hi)>>>1; if (bars[mid]!.openTs<p.time) lo=mid+1; else hi=mid; }
      const i=Math.min(lo,bars.length-1), bar=bars[i]!;
      x=chart.timeScale().logicalToCoordinate((i+(p.time-bar.openTs)/TIMEFRAME_SEC[state.timeframe]) as Logical);
    }
    const y=series.priceToCoordinate(p.price);
    return x == null || y == null ? null : { x, y };
  }
  useEffect(() => {
    const chart=chartRef.current, el=containerRef.current;
    if (!chart || !el) return;
    const draw = () => {
      frame.current=0;
      const items=draftRef.current ? [...drawingsRef.current.filter(d=>d.id!==draftRef.current!.id),draftRef.current] : drawingsRef.current;
      const rows=items.map(d=>({drawing:d,points:d.points.map(screenPoint).filter((p):p is XY=>p!==null)}));
      const next={width:Math.max(0,el.clientWidth-chart.priceScale("right").width()),height:chart.panes()[0]?.getHeight() ?? el.clientHeight-chart.timeScale().height(),rows};
      setView(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    const schedule=()=>{ if (!frame.current) frame.current=requestAnimationFrame(draw); };
    scheduleRef.current=schedule;
    const observer=new ResizeObserver(schedule);observer.observe(el);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.timeScale().subscribeSizeChange(schedule);
    const unsubscribe=market.subscribe(schedule);schedule();
    return()=>{ observer.disconnect();unsubscribe();cancelAnimationFrame(frame.current);frame.current=0;chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);chart.timeScale().unsubscribeSizeChange(schedule); };
  }, [chartVersion, market, scope, symbol]);
  useEffect(()=>scheduleRef.current(),[drawings,draft]);

  useEffect(() => {
    const chart=chartRef.current;
    if (!chart) return;
    // Discard hover indexes before replacing indicator series and their shared timeline.
    chart.clearCrosshairPosition();
    const rows=indicators.map(kind=>({kind,series:chart.addSeries(LineSeries,{color:COLORS[kind],lineWidth:1,title:`${kind} 14`,priceLineVisible:false,lastValueVisible:true, ...(kind === "RSI" ? {priceScaleId:"right"} : {})},kind === "RSI" ? 1 : 0),acc:new IndicatorAccumulator(kind),first:0,closed:0,seeded:false,latest:null as number | null}));
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
    return()=>{unsub();cancelAnimationFrame(raf);try{chart.clearCrosshairPosition();}catch{/* Chart may already be removed. */}for(const row of rows){try{chart.removeSeries(row.series);}catch{/* Chart may already be removed. */}}};
  }, [chartVersion, market, symbol, indicators.join(",")]);

  function anchor(e: PointerEvent<SVGSVGElement>): Anchor | null {
    const el=containerRef.current,chart=chartRef.current,series=seriesRef.current;
    if(!el||!chart||!series)return null;
    const box=el.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;
    const time=chart.timeScale().coordinateToTime(x),price=series.coordinateToPrice(y);
    return typeof time === "number" && price!==null && price>0 ? {time,price:Number(price.toFixed(precision))}:null;
  }
  function begin(e: PointerEvent<SVGSVGElement>) {
    const target=e.target as SVGElement;
    const point=anchor(e);if(!point)return;
    const id=target.getAttribute("data-drawing"),index=target.getAttribute("data-anchor");
    if(tool === "select"){
      if(!id){setSelected(null);return;}
      setSelected(id);
      if(index===null)return;
      const original=drawingsRef.current.find(d=>d.id===id);if(!original)return;
      gesture.current={index:Number(index),editing:true};draftRef.current={...original,points:[...original.points]};setDraft(draftRef.current);
    }else{
      if(drawingsRef.current.length>=64){setNotice("Remove a drawing before adding more (64 maximum).");return;}
      const d:Drawing={id:crypto.randomUUID(),tool,points:tool === "horizontal" || tool === "text" ? [point]:[point,point],...(tool === "text"?{text}: {})};
      draftRef.current=d;setDraft(d);gesture.current={index:null,editing:false};
    }
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const g=gesture.current,d=draftRef.current,p=anchor(e);if(!g||!d||!p)return;
    if(g.index!==null)d.points[g.index]=p;
    else if(d.tool==="brush") {if(d.points.length<256)d.points.push(p);}
    else if(d.tool!=="text" && d.tool!=="horizontal") {
      d.points[1]=p;
      if(d.tool==="channel")d.points[2]={time:d.points[0]!.time,price:d.points[0]!.price+Math.max(Math.abs(p.price-d.points[0]!.price)*.4,10**-precision)};
    }
    if(!moveFrame.current)moveFrame.current=requestAnimationFrame(()=>{moveFrame.current=0;setDraft(draftRef.current?{...draftRef.current,points:[...draftRef.current.points]}:null);scheduleRef.current();});
  }
  function finish() {
    if(!gesture.current)return;
    gesture.current=null;cancelAnimationFrame(moveFrame.current);moveFrame.current=0;
    const d=draftRef.current;draftRef.current=null;setDraft(null);
    if(d){save([...drawingsRef.current.filter(row=>row.id!==d.id),d]);setSelected(d.id);setTool("select");}
  }
  useEffect(()=>()=>{cancelAnimationFrame(moveFrame.current);},[]);
  function zoom(factor:number){const scale=chartRef.current?.timeScale(),range=scale?.getVisibleLogicalRange();if(!range||!scale)return;const middle=(range.from+range.to)/2,half=(range.to-range.from)*factor/2;scale.setVisibleLogicalRange({from:middle-half,to:middle+half});}
  function toggleIndicator(kind:Indicator){const next=indicators.includes(kind)?indicators.filter(i=>i!==kind):[...indicators,kind];setIndicators(next);try{localStorage.setItem(`asm_chart_indicators:${scope}`,JSON.stringify(next));}catch{/* Optional storage. */}}
  const current=drawings.find(d=>d.id===selected);
  return <>
    <nav aria-label="Chart drawing tools" className={styles.rail}>
      {DRAWING_TOOLS.map(t=><button key={t} type="button" title={NAMES[t]} aria-label={NAMES[t]} aria-pressed={tool===t} onClick={()=>{setTool(t);setNotice(t==="select"?"":`${NAMES[t]}: ${t==="text"||t==="horizontal"?"tap":"drag"} on the chart`);}}><ChartToolIcon name={t} /></button>)}
      <span className={styles.divider}/>
      <button type="button" aria-label="Zoom in chart" title="Zoom in" onClick={()=>zoom(.75)}><ChartToolIcon name="zoomIn" /></button>
      <button type="button" aria-label="Zoom out chart" title="Zoom out" onClick={()=>zoom(1.3)}><ChartToolIcon name="zoomOut" /></button>
      <button type="button" aria-label="Fit chart" title="Fit chart" onClick={()=>chartRef.current?.timeScale().fitContent()}><ChartToolIcon name="fit" /></button>
      <button type="button" aria-label="Undo drawing change" title="Undo" disabled={undo.current.length===0} onClick={()=>{const prev=undo.current.pop();if(prev){drawingsRef.current=prev;setDrawings(prev);setSelected(null);try{localStorage.setItem(storageKey,JSON.stringify(prev));}catch{/* Optional storage. */}}}}><ChartToolIcon name="undo" /></button>
      <button type="button" aria-label="Delete selected drawing" title="Delete selected drawing" disabled={!selected} onClick={()=>{save(drawings.filter(d=>d.id!==selected));setSelected(null);}}><ChartToolIcon name="delete" /></button>
    </nav>
    <div className={styles.indicators}>
      <button type="button" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}>ƒx <span>Indicators</span>{indicators.length>0?` · ${indicators.length}`:""}</button>
      {menu&&<div className={styles.menu}>{INDICATORS.map(i=><label key={i}><input type="checkbox" checked={indicators.includes(i)} onChange={()=>toggleIndicator(i)}/><span style={{color:COLORS[i]}}>{i} 14</span></label>)}<output data-testid="indicator-values" className="text-[10px] text-ink-2">{indicatorReadout}</output><button type="button" onClick={()=>setMenu(false)}>Done</button></div>}
    </div>
    {(tool==="text"||current?.tool==="text")&&<div className={styles.annotation}><input aria-label="Annotation text" maxLength={120} value={current?.tool==="text"?current.text??"":text} onChange={e=>current?.tool==="text"?save(drawings.map(d=>d.id===current.id?{...d,text:e.target.value}:d)):setText(e.target.value)}/></div>}
    {notice&&<button type="button" className={styles.notice} onClick={()=>setNotice("")} aria-label="Dismiss chart hint">{notice} ×</button>}
    <svg className={styles.canvas} width={view.width} height={view.height} data-chart-editing={tool!=="select"||!!draft} aria-label="Chart drawings" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;draftRef.current=null;setDraft(null);}}>
      {tool!=="select"&&<rect className={styles.capture} x="48" y="185" width={Math.max(0,view.width-48)} height={Math.max(0,view.height-185)} fill="transparent"/>}
      {view.rows.map(({drawing:d,points:p})=>{
        const a=p[0],b=p[1];if(!a)return null;
        const active=d.id===selected,color=active?"#8cc2ff":"#5e9fff";
        const props={stroke:color,strokeWidth:active?2:1.5,fill:"none","data-drawing":d.id,className:styles.shape};
        let content;
        if(d.tool==="horizontal")content=<><line {...props} x1="0" x2={view.width} y1={a.y} y2={a.y}/><text x={view.width-6} y={a.y-5} textAnchor="end" fill={color} fontSize="11">{d.points[0]!.price.toFixed(precision)}</text></>;
        else if(d.tool==="text")content=<text {...props} stroke="none" fill={color} x={a.x} y={a.y} fontSize="14">{d.text??"Note"}</text>;
        else if(d.tool==="brush")content=<polyline {...props} points={p.map(v=>`${v.x},${v.y}`).join(" ")}/>;
        else if(b && d.tool==="fib")content=<>{[0,.236,.382,.5,.618,.786,1].map(level=>{const y=a.y+(b.y-a.y)*level;return <g key={level}><line {...props} x1={Math.min(a.x,b.x)} x2={Math.max(a.x,b.x)} y1={y} y2={y}/><text x={Math.max(a.x,b.x)+4} y={y+3} fill={color} fontSize="10">{level} · {(d.points[0]!.price+(d.points[1]!.price-d.points[0]!.price)*level).toFixed(precision)}</text></g>;})}</>;
        else if(b && d.tool==="channel"){const offset=(p[2]?.y??a.y-35)-a.y;content=<><polygon points={`${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y+offset} ${a.x},${a.y+offset}`} fill="#5e9fff18"/><line {...props} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><line {...props} x1={a.x} y1={a.y+offset} x2={b.x} y2={b.y+offset}/></>;}
        else if(b){content=<><line {...props} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>{d.tool==="measure"&&<><rect x={Math.min(a.x,b.x)} y={Math.min(a.y,b.y)} width={Math.abs(b.x-a.x)} height={Math.abs(b.y-a.y)} fill="#5e9fff18"/><text x={b.x+5} y={b.y-8} fill={color} fontSize="11">{((d.points[1]!.price/d.points[0]!.price-1)*100).toFixed(2)}% · {Math.round(Math.abs(d.points[1]!.time-d.points[0]!.time)/60)}m</text></>}</>;}
        return <g key={d.id}>{content}{active&&d.tool!=="brush"&&p.map((v,i)=><circle key={i} data-drawing={d.id} data-anchor={i} className={styles.handle} cx={v.x} cy={v.y} r="6" fill="#0c1425" stroke={color} strokeWidth="2"/>)}</g>;
      })}
    </svg>
  </>;
}
