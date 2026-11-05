"use client";
import { useEffect,useMemo,useRef,type RefObject } from "react";
import type { IChartApi,UTCTimestamp } from "lightweight-charts";
import { TIMEFRAME_SEC,type TradeView } from "@asm/contracts";
import type { MarketStore } from "@/components/shell/market-store";
import { countdown } from "@/lib/format-time";

/** Fixed contract expiry markers: DOM patches only, with no tick-rate React state. */
export function OtcExpiry({trades,chartRef,market,chartVersion}:{trades:TradeView[];chartRef:RefObject<IChartApi|null>;market:MarketStore;chartVersion:number}){
  const rows=useRef(new Map<string,HTMLDivElement>());
  const positions=useMemo(()=>trades.filter(t=>t.mode==="OTC_FIXED"&&t.status==="OPEN"),[trades]);
  useEffect(()=>{
    const chart=chartRef.current;if(!chart)return;
    let frame=0;
    const draw=()=>{
      frame=0;
      const state=market.getSnapshot().chart,last=state.forming??state.candles.at(-1);
      const lastX=last?chart.timeScale().timeToCoordinate(last.openTs as UTCTimestamp):null;
      const width=chart.timeScale().width(),spacing=chart.timeScale().options().barSpacing;
      const now=Date.now()/1000;
      for(const trade of positions){
        const row=rows.current.get(trade.id);if(!row)continue;
        const x=lastX===null||!last?null:lastX+(trade.expiryTs-last.openTs)/TIMEFRAME_SEC[state.timeframe]*spacing;
        row.hidden=x===null||x<0||x>width||trade.symbol!==state.symbol||now>trade.expiryTs+5;
        if(x!==null)row.style.transform=`translateX(${Math.round(x)}px)`;
        const label=row.firstElementChild;if(label)label.textContent=`${trade.direction==="UP"?"↑":"↓"} Expiry ${countdown(Math.max(0,trade.expiryTs-now))}`;
      }
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};
    const unsubscribe=market.subscribe(schedule),timer=setInterval(schedule,1000);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);chart.timeScale().subscribeSizeChange(schedule);schedule();
    return ()=>{unsubscribe();clearInterval(timer);cancelAnimationFrame(frame);chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);chart.timeScale().unsubscribeSizeChange(schedule);};
  },[positions,chartRef,market,chartVersion]);
  return <div aria-label="OTC expiry markers" className="pointer-events-none absolute inset-x-0 bottom-7 top-0 z-[1] overflow-hidden">
    {positions.map((trade,i)=><div key={trade.id} hidden ref={node=>{if(node)rows.current.set(trade.id,node);else rows.current.delete(trade.id);}}
      className="absolute bottom-0 left-0 top-0 border-l border-dashed border-caution/65">
      <span className="absolute whitespace-nowrap rounded border border-rule bg-ground/90 px-1.5 py-1 text-[10px] text-ink-2" style={{top:100+(i%4)*24,left:4}}/>
    </div>)}
  </div>;
}
