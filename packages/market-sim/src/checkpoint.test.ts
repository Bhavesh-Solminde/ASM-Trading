import { describe,it,expect } from "vitest";
import { AnchoredMarket } from "./anchored-market";
import { OrderBook } from "./order-book";
import { MULTI_MARKETS } from "./catalogue";

describe("durable market state",()=>{
  it.each([false,true])("resumes every order and random draw after JSON restart, tobs=%s",tobs=>{
    const start=Date.parse("2026-11-05T00:00:00Z");
    const m=new AnchoredMarket({symbol:"BTCUSDT",price:80000,tickSize:.01,minuteBps:7,group:"Crypto"},start,71,0,true);
    m.advance(start+600000);
    if(tobs)m.startTobs({count:100,mix:"buy-heavy",arrival:"staggered",size:"large",durationMs:900000});
    m.advance(start+642000);
    const checkpoint=JSON.parse(JSON.stringify(m.checkpoint()));
    const resumed=AnchoredMarket.restore(checkpoint);
    for(let time=start+648000;time<=start+1800000;time+=6000){m.advance(time);resumed.advance(time);}
    expect(resumed.snapshot()).toEqual(m.snapshot());
    expect(resumed.book.checkpoint()).toEqual(m.book.checkpoint());
    expect(resumed.executionAudit()).toEqual(m.executionAudit());
    expect(resumed.botLeaderboard()).toEqual(m.botLeaderboard());
  });
  it("rejects corrupted reservations without accepting a damaged book",()=>{
    const b=new OrderBook();b.register("a",1000,100);b.submit({ownerId:"a",side:"BUY",price:10,quantity:20,expiresAt:100},0);
    const state=b.checkpoint();state.wallets[0]!.reservedCash--;
    expect(()=>OrderBook.restore(state)).toThrow("reservations");
    expect(b.wallet("a").reservedCash).toBe(200);
  });
  it("marks all wallet assets once, including reserved assets",()=>{
    const m=new AnchoredMarket({symbol:"BTCUSDT",price:80000,tickSize:.01,minuteBps:7,group:"Crypto"},1000);
    m.advance(61000);
    const mark=m.checkpoint().last!.price,initial=1e12+1e6*8000000;
    const leaders=m.botLeaderboard(200);
    expect(leaders).toHaveLength(200);
    for(const row of leaders){const w=m.book.wallet(row.id.split(":")[1]!);expect(row.pnl).toBe((w.cash+w.inventory*mark-initial)*.01);}
    expect(leaders[0]!.returnPct).toBeGreaterThanOrEqual(leaders.at(-1)!.returnPct);
  });
  it("keeps all 30 distinct market definitions and precision",()=>{
    expect(MULTI_MARKETS).toHaveLength(30);expect(new Set(MULTI_MARKETS.map(m=>m.symbol)).size).toBe(30);
    for(const spec of MULTI_MARKETS){expect(spec.yahoo).toBeTruthy();expect(spec.base).toBeGreaterThan(0);expect(spec.minuteBps).toBeGreaterThan(0);}
  });
});
