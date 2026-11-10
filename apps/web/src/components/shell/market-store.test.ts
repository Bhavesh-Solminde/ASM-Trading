// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import type { OtcMarketMessage } from "@asm/contracts";
import { MarketStore } from "./market-store";
afterEach(()=>vi.unstubAllGlobals());
it("clears all cached chart generations when a restarted worker announces itself",()=>{
  vi.stubGlobal("requestAnimationFrame",()=>1);
  const assets=[{symbol:"BTCUSDT",payoutPct:92},{symbol:"EURUSD",payoutPct:92}],store=new MarketStore("BTCUSDT","1m",assets);
  const packet=(symbol:string):OtcMarketMessage=>({type:"otc:market",symbol,timeframe:"1m",generation:"old",sequence:1,time:1800000060000,reset:true,retainedFrom:1800000000,
    candles:[{openTs:1800000000,o:100,h:101,l:99,c:100,volume:1}],reference:null,depth:{bids:[],asks:[]},tape:[],phase:"Bots only",activeTobs:0});
  store.apply(packet("BTCUSDT"));store.selectSymbol("EURUSD");store.apply(packet("EURUSD"));store.selectSymbol("BTCUSDT");
  expect(store.getSnapshot().chart.candles).toHaveLength(1);
  store.selectTimeframe("5m"); // Restart can arrive while a cache miss is loading.
  store.apply({type:"ready",serverTs:Date.now(),model:"OTC_FIXED",generation:"new"});
  expect(store.getSnapshot().chart.candles).toHaveLength(0);expect(store.getSnapshot().otc).toBeNull();
  store.selectSymbol("EURUSD");expect(store.getSnapshot().chart.generation).toBeUndefined();expect(store.getSnapshot().chart.candles).toHaveLength(0);
});
