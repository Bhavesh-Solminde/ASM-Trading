import { expect, it } from "vitest";
import { AnchoredMarket } from "./anchored-market";
const start=Date.parse("2026-11-05T18:00:00+05:30"),profile={symbol:"TEST",price:100,minuteBps:4,tickSize:.0001,group:"India"};
it("changing an external reference cannot change an execution or candle until new orders match",()=>{
  const m=new AnchoredMarket(profile,start,71);m.advance(start+60000);
  const before=m.snapshot();
  expect(m.setAnchor({price:95,quoteTime:start,observedAt:start+60000})).toBe(true);
  expect(m.snapshot().candles).toEqual(before.candles);
  expect(m.snapshot().lastPrice).toBe(before.lastPrice);
  expect(m.setAnchor({price:90,quoteTime:start-1,observedAt:start+60000})).toBe(false);
  expect(m.setAnchor({price:90,quoteTime:start+120000,observedAt:start+60000})).toBe(false);
  expect(m.setAnchor({price:NaN,quoteTime:start,observedAt:start+60000})).toBe(false);
  m.advance(start+66000);expect(m.snapshot().fills).toBeGreaterThan(before.fills);
});
it("produces identical executions regardless of polling/fast-forward chunk sizes",()=>{
  const a=new AnchoredMarket(profile,start,51, .02,true),b=new AnchoredMarket(profile,start,51,.02,true);
  for(let t=start;t<=start+600000;t+=1000)a.advance(t);
  b.advance(start+600000);expect(a.executionAudit()).toEqual(b.executionAudit());expect(a.snapshot()).toEqual(b.snapshot());
});
it("book funding and candle high/low/volume reconcile to genuine executions",()=>{
  const m=new AnchoredMarket(profile,start,19,0,true);m.advance(start+900000);
  const fills=m.executionAudit(),bars=m.snapshot().candles;
  for(const b of bars){const own=fills.filter(f=>Math.floor(f.time/60000)*60===b.time);expect(b.volume).toBe(own.reduce((n,f)=>n+f.quantity,0));
    expect(b.high).toBeCloseTo(Math.max(b.open,...own.map(f=>f.price*profile.tickSize)),8);
    expect(b.low).toBeCloseTo(Math.min(b.open,...own.map(f=>f.price*profile.tickSize)),8);}
  const wallets=m.botIds.map(id=>m.book.wallet(id));expect(wallets.reduce((n,w)=>n+w.cash,0)).toBe(200e12);expect(wallets.reduce((n,w)=>n+w.inventory,0)).toBe(200e6);
});
