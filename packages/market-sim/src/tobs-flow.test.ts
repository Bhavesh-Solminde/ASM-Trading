import { expect,it } from "vitest";
import { AnchoredMarket,type TobsFlowConfig } from "./anchored-market";
const start=Date.parse("2026-11-05T18:00:00+05:30"),profile={symbol:"TEST",price:100,minuteBps:5,tickSize:.0001,group:"India"};
const config:TobsFlowConfig={count:100,mix:"buy-heavy",arrival:"staggered",size:"medium",durationMs:300000};
function market(){const m=new AnchoredMarket(profile,start,71,0,true);m.advance(start+600000);return m;}
it("activates generated tobs without moving prices until real orders match",()=>{
  const m=market(),before=m.snapshot();m.startTobs(config);
  expect(m.snapshot().lastPrice).toBe(before.lastPrice);expect(m.snapshot().candles).toEqual(before.candles);
  expect(m.snapshot().tobs.phase).toBe("Arriving");
  m.advance(m.now()+60000);const s=m.snapshot();
  expect(s.tobs.active).toBe(true);expect(s.tobs.activeTobs).toBeGreaterThan(0);expect(s.tobs.orders).toBeGreaterThan(0);expect(s.tobs.matchedLots).toBeGreaterThan(0);
  expect(s.tobs.buyLots).toBeGreaterThan(s.tobs.sellLots);expect(s.executions.some(e=>e.origin==="Tobs")).toBe(true);
  expect(s.tobs.matchedLots).toBe(m.executionAudit().filter(e=>e.takerId.startsWith("tobs-")).reduce((n,e)=>n+e.quantity,0));
  const wallets=[...m.botIds,...Array.from({length:100},(_,i)=>`tobs-${i+1}`)].map(id=>m.book.wallet(id));
  expect(wallets.reduce((n,w)=>n+w.cash,0)).toBe(300e12);expect(wallets.reduce((n,w)=>n+w.inventory,0)).toBe(300e6);
  expect(wallets.every(w=>w.cash>=w.reservedCash&&w.inventory>=w.reservedInventory)).toBe(true);
});
it("creates a genuine changed price path and reconciles full OHLCV with every match",()=>{
  const a=market(),b=market();a.startTobs(config);const end=a.now()+600000;a.advance(end);b.advance(end);
  expect(a.snapshot().candles).not.toEqual(b.snapshot().candles);
  for(const bar of a.snapshot().candles){const own=a.executionAudit().filter(e=>Math.floor(e.time/60000)*60===bar.time);
    expect(bar.volume).toBe(own.reduce((n,e)=>n+e.quantity,0));expect(bar.high).toBeCloseTo(Math.max(bar.open,...own.map(e=>e.price*profile.tickSize)),8);expect(bar.low).toBeCloseTo(Math.min(bar.open,...own.map(e=>e.price*profile.tickSize)),8);
  }
  expect(a.snapshot().tobs.active).toBe(false);expect(a.snapshot().tobs.phase).toBe("Bots only");
});
it("detects liquidity stress and recovery from observed flow without a forced price",()=>{
  const m=market();m.startTobs({...config,size:"large",arrival:"burst"});m.advance(m.now()+6000);
  expect(m.snapshot().tobs.phase).toBe("Liquidity stress");
  expect(m.snapshot().tobs.matchedLots).toBeLessThan(m.snapshot().tobs.requestedLots);
  const before=m.snapshot().lastPrice,orders=m.snapshot().tobs.orders;m.stopTobs();expect(m.snapshot().lastPrice).toBe(before);expect(m.snapshot().tobs.phase).toBe("Recovery");
  m.advance(m.now()+120000);expect(m.snapshot().tobs.orders).toBe(orders);expect(m.snapshot().tobs.phase).toBe("Bots only");
});
it("retains actor funding between scenarios and rejects malformed controls",()=>{
  const m=market();for(const invalid of [{...config,count:101},{...config,durationMs:-1},{...config,price:1}])expect(()=>m.startTobs(invalid as TobsFlowConfig)).toThrow();
  m.startTobs(config);expect(()=>m.startTobs(config)).toThrow();m.advance(m.now()+6000);m.stopTobs();const balance=m.book.wallet("tobs-1");m.startTobs(config);expect(m.book.wallet("tobs-1")).toEqual(balance);
});
it("preserves all tobs events and market matches under different advance chunk sizes",()=>{
  const a=market(),b=market();a.startTobs(config);b.startTobs(config);const begin=a.now(),end=begin+600000;
  for(let t=begin;t<=end;t+=1000)a.advance(t);b.advance(end);
  expect(a.executionAudit()).toEqual(b.executionAudit());expect(a.snapshot()).toEqual(b.snapshot());
});
