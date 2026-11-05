import { TIMEFRAME_SEC,type CandleDto,type Timeframe,type OtcMarketMessage } from "@asm/contracts";
import type { MarketWorld } from "@asm/market-sim";

export function publicMarket(state:ReturnType<MarketWorld["snapshot"]>,timeframe:Timeframe,generation:string,since?:number,openTobs=0):OtcMarketMessage{
  const width=TIMEFRAME_SEC[timeframe],buckets=new Map<number,CandleDto>();
  for(const b of state.market.candles){
    const openTs=Math.floor(b.time/width)*width,existing=buckets.get(openTs);
    if(existing){existing.h=Math.max(existing.h,b.high);existing.l=Math.min(existing.l,b.low);existing.c=b.close;existing.volume=(existing.volume??0)+b.volume;}
    else buckets.set(openTs,{openTs,o:b.open,h:b.high,l:b.low,c:b.close,volume:b.volume});
  }
  const retainedFrom=buckets.keys().next().value??null;
  const latest=[...buckets.keys()].at(-1)??null;
  const reset=since===undefined||retainedFrom===null||latest===null||since<retainedFrom||since>latest||since%width!==0;
  const q=state.reference;
  return {type:"otc:market",generation,symbol:state.market.symbol,timeframe,time:state.time,sequence:state.sequence,reset,retainedFrom,
    candles:[...buckets.values()].filter(b=>reset||b.openTs>=since!),
    reference:q?{price:q.price,source:q.source,quoteTime:q.quoteTime,receivedAt:q.receivedAt,kind:q.kind,
      status:q.session==="CLOSED"?"Closed · last quote":Date.now()-q.quoteTime>2400000?"Stale reference":q.kind==="FUTURES_PROXY"?"Futures proxy":q.kind==="PUBLIC_DELAYED"?"May be delayed":"Public quote"}:null,
    depth:state.market.depth,
    tape:state.market.executions.map(f=>({sequence:f.sequence,time:f.time,price:f.price,quantity:f.quantity,side:f.side,origin:f.origin})),
    phase:!state.market.depth.bids.length||!state.market.depth.asks.length?"Liquidity stress":state.market.tobs.phase,
    activeTobs:state.market.tobs.activeTobs,openTobs};
}
