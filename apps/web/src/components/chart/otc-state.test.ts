import { expect,it } from "vitest";
import type { OtcMarketMessage } from "@asm/contracts";
import { applyChartMessage,initialChartState } from "@asm/client-core";
const base=1800000000;
const bar=(openTs:number,c=100)=>({openTs,o:100,h:110,l:90,c,volume:20});
function packet(overrides:Partial<OtcMarketMessage>={}):OtcMarketMessage{return {type:"otc:market",generation:"a",symbol:"BTCUSDT",timeframe:"1m",time:(base+120)*1000,sequence:1,reset:true,retainedFrom:base,candles:[bar(base),bar(base+60),bar(base+120)],reference:null,depth:{bids:[],asks:[]},tape:[],phase:"Bots only",activeTobs:0,...overrides};}
it("merges forming and newly closed bars without replacing unchanged history",()=>{
  const state=applyChartMessage(initialChartState("BTCUSDT","1m"),packet());
  expect(state.candles).toHaveLength(2);expect(state.forming!.volume).toBe(20);
  const update=applyChartMessage(state,packet({reset:false,sequence:2,candles:[bar(base+120,101)]}));
  expect(update.candles).toBe(state.candles);expect(update.forming!.c).toBe(101);
  const next=applyChartMessage(update,packet({reset:false,sequence:3,time:(base+180)*1000,candles:[bar(base+120,101),bar(base+180,102)]}));
  expect(next.candles).toHaveLength(3);expect(next.candles.at(-1)!.c).toBe(101);expect(next.forming!.c).toBe(102);
});
it("rejects stale sequences, wrong markets and incomplete generation changes",()=>{
  const state=applyChartMessage(initialChartState("BTCUSDT","1m"),packet({sequence:10}));
  expect(applyChartMessage(state,packet({sequence:9}))).toBe(state);
  expect(applyChartMessage(state,packet({symbol:"EURUSD"}))).toBe(state);
  expect(applyChartMessage(state,packet({generation:"b",reset:false}))).toBe(state);
  expect(applyChartMessage(state,packet({generation:"b",reset:true})).generation).toBe("b");
});
it("retains older loaded bars during ordinary server history rollover",()=>{
  const state=applyChartMessage(initialChartState("BTCUSDT","1m"),packet());
  const next=applyChartMessage(state,packet({reset:false,sequence:2,retainedFrom:base+60,candles:[bar(base+120)]}));
  expect(next.candles[0]!.openTs).toBe(base);
});
