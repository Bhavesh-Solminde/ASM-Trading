"use client";
import { useEffect,useLayoutEffect,useRef,useState,type RefObject,type PointerEvent as ReactPointerEvent } from "react";
import { LineStyle,type IChartApi,type ISeriesApi } from "lightweight-charts";
import type { MarketStore } from "@/components/shell/market-store";
import { snapProtection,type OtcProtectionDraft } from "./otc-protection";

type Kind="stopLoss"|"takeProfit";
type Geometry={height:number;axis:number;stopLoss:number|null;takeProfit:number|null};
/** Draft levels only. Accepted OTC terms remain immutable and settle on executions. */
export function OtcProtection({draft,onChange,seriesRef,chartRef,containerRef,market,chartVersion,precision,tickSize}:{
  draft:OtcProtectionDraft;onChange:(draft:OtcProtectionDraft)=>void;seriesRef:RefObject<ISeriesApi<any>|null>;chartRef:RefObject<IChartApi|null>;
  containerRef:RefObject<HTMLDivElement|null>;market:MarketStore;chartVersion:number;precision:number;tickSize:number;
}){
  const model=useRef({draft,onChange});model.current={draft,onChange};
  const drag=useRef<{kind:Kind;before:OtcProtectionDraft;pointer:number;target:HTMLButtonElement;auto:boolean}|null>(null);
  const [geometry,setGeometry]=useState<Geometry>({height:0,axis:65,stopLoss:null,takeProfit:null});
  const frame=useRef(0),schedule=useRef(()=>{});
  function release(cancel=false){
    const active=drag.current;if(!active)return;drag.current=null;
    try{chartRef.current?.priceScale("right").applyOptions({autoScale:active.auto});}catch{}
    try{if(active.target.hasPointerCapture(active.pointer))active.target.releasePointerCapture(active.pointer);}catch{}
    if(cancel)model.current.onChange(active.before);schedule.current();
  }
  useEffect(()=>{const abort=()=>release(true);window.addEventListener("blur",abort);return()=>{window.removeEventListener("blur",abort);release();};},[]);
  useEffect(()=>{if(!draft.enabled)release();},[draft.enabled]);
  useLayoutEffect(()=>{
    const chart=chartRef.current,el=containerRef.current;if(!chart||!el||!draft.enabled)return;
    const draw=()=>{
      frame.current=0;const series=seriesRef.current;if(!series)return;
      const d=model.current.draft,price=market.getSnapshot().chart.lastPrice;
      if(d.enabled&&(d.stopLoss===null||d.takeProfit===null)&&price){
        const a=series.coordinateToPrice(el.clientHeight*.35),b=series.coordinateToPrice(el.clientHeight*.65);
        const distance=Math.max(tickSize*10,a!==null&&b!==null?Math.abs(a-b)*.3:price*.001);
        const below=snapProtection(Math.max(tickSize,price-distance),tickSize,precision),above=snapProtection(price+distance,tickSize,precision);
        model.current.onChange({...d,stopLoss:d.direction==="UP"?below:above,takeProfit:d.direction==="UP"?above:below});return;
      }
      const next={height:el.clientHeight-chart.timeScale().height(),axis:chart.priceScale("right").width(),
        stopLoss:d.stopLoss===null?null:series.priceToCoordinate(d.stopLoss),takeProfit:d.takeProfit===null?null:series.priceToCoordinate(d.takeProfit)};
      setGeometry(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    const queue=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=requestAnimationFrame(draw);});};
    schedule.current=queue;const observer=new ResizeObserver(queue);observer.observe(el);
    const unsubscribe=market.subscribe(queue);chart.timeScale().subscribeVisibleLogicalRangeChange(queue);chart.subscribeCrosshairMove(queue);
    el.addEventListener("wheel",queue,{passive:true});queue();
    return()=>{release();observer.disconnect();unsubscribe();chart.timeScale().unsubscribeVisibleLogicalRangeChange(queue);chart.unsubscribeCrosshairMove(queue);el.removeEventListener("wheel",queue);cancelAnimationFrame(frame.current);frame.current=0;schedule.current=()=>{};};
  },[chartVersion,market,precision,tickSize,draft.enabled]);
  // Update native lines in place as the user drags. Never recreate a chart or book.
  const levelsRef=useRef<ReturnType<ISeriesApi<any>["createPriceLine"]>[]>([]);
  useLayoutEffect(()=>{
    const series=seriesRef.current;if(!series||!draft.enabled)return;
    const entries=(["stopLoss","takeProfit"] as const).map(kind=>series.createPriceLine({price:draft[kind]??0,color:kind==="stopLoss"?"#f23645":"#089981",lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:draft[kind]!==null,lineVisible:draft[kind]!==null,title:kind==="stopLoss"?"SL draft":"TP draft"}));
    levelsRef.current=entries;return()=>{levelsRef.current=[];for(const line of entries)try{series.removePriceLine(line);}catch{}};
  },[draft.enabled,chartVersion]);
  useLayoutEffect(()=>{[draft.stopLoss,draft.takeProfit].forEach((price,i)=>levelsRef.current[i]?.applyOptions({price:price??0,lineVisible:price!==null,axisLabelVisible:price!==null}));schedule.current();},[draft]);
  function begin(e:ReactPointerEvent<HTMLButtonElement>,kind:Kind){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();release();
    const scale=chartRef.current?.priceScale("right");drag.current={kind,before:model.current.draft,pointer:e.pointerId,target:e.currentTarget,auto:scale?.options().autoScale??true};
    scale?.applyOptions({autoScale:false});try{e.currentTarget.setPointerCapture(e.pointerId);}catch{release(true);}
  }
  function move(e:ReactPointerEvent<HTMLButtonElement>){
    const active=drag.current,rect=containerRef.current?.getBoundingClientRect();if(!active||!rect)return;
    const price=seriesRef.current?.coordinateToPrice(Math.max(0,Math.min(geometry.height,e.clientY-rect.top)));
    if(price===null||price===undefined||!Number.isFinite(price)||price<=0)return;
    model.current.onChange({...model.current.draft,[active.kind]:snapProtection(price,tickSize,precision)});
  }
  if(!draft.enabled)return null;
  return <div className="pointer-events-none absolute inset-0 z-20" aria-label="SL / TP chart controls">
    {(["stopLoss","takeProfit"] as const).map(kind=>{
      const y=geometry[kind],label=kind==="stopLoss"?"SL":"TP";
      return y!==null&&y>=20&&y<=geometry.height-20?<button key={kind} type="button" role="slider" aria-orientation="vertical" aria-label={`Drag ${kind==="stopLoss"?"stop loss":"take profit"}`} aria-valuenow={draft[kind]??undefined} aria-valuetext={draft[kind]?.toFixed(precision)}
        onPointerDown={e=>begin(e,kind)} onPointerMove={move} onPointerUp={()=>release()} onPointerCancel={()=>release(true)} onLostPointerCapture={()=>release()}
        onKeyDown={e=>{if(e.key==="Escape"){release(true);return;}if(!["ArrowUp","ArrowDown"].includes(e.key))return;e.preventDefault();const current=model.current.draft,value=current[kind];if(value!==null)model.current.onChange({...current,[kind]:snapProtection(Math.max(tickSize,value+(e.key==="ArrowUp"?1:-1)*tickSize*(e.shiftKey?10:1)),tickSize,precision)});}}
        className="pointer-events-auto absolute flex h-9 touch-none items-center gap-2 rounded border bg-[#0c141c] px-3 text-xs font-bold shadow-md focus-visible:outline-2 focus-visible:outline-white"
        style={{top:y-18,right:geometry.axis+14,color:kind==="stopLoss"?"#f23645":"#089981",borderColor:"currentColor",cursor:"ns-resize"}}>{label} <span aria-hidden>↕</span> Drag</button>:null;
    })}
    <span className="absolute bottom-14 left-3 rounded bg-[#0c141c]/90 px-2 py-1 text-xs text-ink-2">Drag SL / TP before placing your {draft.direction==="UP"?"Buy":"Sell"} trade</span>
  </div>;
}
