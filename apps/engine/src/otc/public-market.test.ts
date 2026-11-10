import { expect,it } from "vitest";
import { MarketWorld } from "@asm/market-sim";
import { publicMarket } from "./public-market";
const world=new MarketWorld(Date.parse("2026-11-05T10:00:00Z")),state=world.snapshot("BTCUSDT");
it("accepts an aligned retained cursor and resets future, misaligned and expired cursors",()=>{
  const last=state.market.candles.at(-1)!.time;
  expect(publicMarket(state,"1m","generation",last).reset).toBe(false);
  expect(publicMarket(state,"1m","generation",last).candles).toHaveLength(1);
  for(const cursor of [last+60,last+1,0]){
    const message=publicMarket(state,"1m","generation",cursor);expect(message.reset).toBe(true);expect(message.candles).toHaveLength(state.market.candles.length);
  }
});
it("aggregates matched volume without dropping any minute bucket",()=>{
  const minute=publicMarket(state,"1m","g"),five=publicMarket(state,"5m","g");
  expect(five.candles.reduce((n,b)=>n+(b.volume??0),0)).toBe(minute.candles.reduce((n,b)=>n+(b.volume??0),0));
  expect(five.candles.at(-1)!.c).toBe(minute.candles.at(-1)!.c);
});
