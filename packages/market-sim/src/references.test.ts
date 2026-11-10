import { describe,it,expect } from "vitest";
import { MULTI_MARKETS,type ReferenceQuote } from "./catalogue";
import { ReferencePoller,type ReferenceSchedule } from "./references";

describe("reference polling",()=>{
  const start=Date.parse("2026-11-05T10:00:00+05:30");
  function harness(keylessRates=true){
    let now=start;const saved:ReferenceQuote[]=[],calls:string[]=[];
    let fail=false;
    const schedules=new Map<string,ReferenceSchedule>();
    const repository={load:async()=>saved,save:async(q:ReferenceQuote)=>{saved.push({...q});},loadSchedule:async()=>[...schedules.values()],saveSchedule:async(s:ReferenceSchedule)=>{schedules.set(s.group,{...s});}};
    const transport=async (url:string)=>{
      calls.push(url);if(fail)throw new Error("Provider HTTP 429");
      if(url.includes("binance"))return MULTI_MARKETS.filter(s=>s.group==="Crypto").map(s=>({symbol:s.symbol,price:String(s.base)}));
      if(url.includes("live-rates"))return MULTI_MARKETS.filter(s=>s.group==="Forex"||["XAUUSD","XAGUSD"].includes(s.symbol)).map(s=>({currency:s.symbol,rate:String(s.base),timestamp:now/1000}));
      if(url.includes("allIndices"))return {timestamp:"05-Nov-2026 10:00:00",data:[{index:"NIFTY 50",last:24000}]};
      const symbol=MULTI_MARKETS.find(s=>url.includes(encodeURIComponent(s.yahoo)))!;
      return {chart:{result:[{meta:{regularMarketPrice:symbol.base,regularMarketTime:now/1000}}]}};
    };
    const restart=()=>new ReferencePoller(repository,transport,()=>now,()=>0,{keylessRates});
    const poller=restart();
    return {poller,saved,calls,schedules,restart,setNow:(v:number)=>{now=v;},setFail:()=>{fail=true;}};
  }
  it("fetches all 30 instruments centrally and respects provider intervals",async()=>{
    const h=harness();await h.poller.initialize();await h.poller.poll();
    expect(h.poller.all()).toHaveLength(30);
    expect(h.calls.filter(c=>c.includes("live-rates"))).toHaveLength(1);
    expect(h.calls.filter(c=>c.includes("binance"))).toHaveLength(1);
    const count=h.calls.length;await h.poller.poll();expect(h.calls).toHaveLength(count);
    h.setNow(start+60000);await h.poller.poll();expect(h.calls).toHaveLength(count+1);
    expect(h.poller.get("BTCUSDT")!.source).toContain("receipt timestamp");
    expect(h.poller.get("WTI")!.kind).toBe("FUTURES_PROXY");
  });
  it("keeps last-good quotes and backs off on rate limits",async()=>{
    const h=harness();await h.poller.poll();const before=h.poller.all();h.setFail();h.setNow(start+900000);await h.poller.poll();
    expect(h.poller.all()).toEqual(before);expect(h.poller.errors.size).toBe(18); // FX/metals are not due before 20 minutes.
    const count=h.calls.length;h.setNow(start+960000);await h.poller.poll();expect(h.calls).toHaveLength(count);
    h.setNow(start+1020000);await h.poller.poll();expect(h.calls).toHaveLength(count+1);
    h.setNow(start+1200000);await h.poller.poll();expect(h.poller.errors.size).toBe(30);
  });
  it("persists attempted-pull cooldowns and consecutive backoff across restarts",async()=>{
    const h=harness();h.setFail();await h.poller.poll();
    const count=h.calls.length;h.setNow(start+60000);const resumed=h.restart();await resumed.initialize();await resumed.poll();expect(h.calls).toHaveLength(count);
    h.setNow(start+120000);await resumed.poll();expect(h.schedules.get("crypto")!.failures).toBe(2);expect(h.schedules.get("crypto")!.nextDueAt).toBe(start+360000);
    const after=h.calls.length;h.setNow(start+180000);const restartedAgain=h.restart();await restartedAgain.initialize();await restartedAgain.poll();expect(h.calls).toHaveLength(after);
  });
  it("lets a second staging engine use fallback rates without consuming keyless IP quota",async()=>{
    const h=harness(false);await h.poller.initialize();await h.poller.poll();
    expect(h.poller.all()).toHaveLength(30);expect(h.calls.some(url=>url.includes("live-rates"))).toBe(false);
  });
  it("rejects invalid and older inputs without publishing or persisting them",async()=>{
    const h=harness();await h.poller.poll();const quote=h.poller.get("BTCUSDT")!,count=h.saved.length;
    for(const changes of [{price:NaN},{price:-1},{quoteTime:start-1},{quoteTime:start+120000},{symbol:"UNKNOWN"}])expect(await h.poller.accept({...quote,...changes})).toBe(false);
    expect(h.saved).toHaveLength(count);expect(h.poller.get("BTCUSDT")).toEqual(quote);
  });
  it("restores timestamps from storage and does not publish when persistence fails",async()=>{
    const h=harness();await h.poller.poll();const quote=h.poller.get("BTCUSDT")!;
    const poller=new ReferencePoller({load:async()=>[quote],save:async()=>{throw new Error("storage down");}},async()=>[],()=>start,()=>0);
    await poller.initialize();expect(poller.get("BTCUSDT")).toEqual(quote);
    await expect(poller.accept({...quote,price:1})).rejects.toThrow("storage down");expect(poller.get("BTCUSDT")).toEqual(quote);
  });
  it("calibrates only completed contiguous bars while keeping the primary reference",async()=>{
    const h=harness();await h.poller.poll();const quote=h.poller.get("BTCUSDT")!,saved:ReferenceQuote[]=[];
    const poller=new ReferencePoller({load:async()=>[quote],save:async q=>{saved.push(q);}},async()=>[
      ...Array.from({length:101},(_,i)=>[start-(101-i)*300000,0,0,0,80000*Math.exp(Math.sin(i)*.001)]),
      [start,0,0,0,999999999], // current unclosed candle must not affect calibration
    ],()=>start,()=>0);
    await poller.initialize();await poller.calibrate();const updated=poller.get("BTCUSDT")!;
    expect(updated.sampleBars).toBe(101);expect(updated.minuteBps).toBeGreaterThan(.2);
    expect(updated.price).toBe(quote.price);expect(updated.quoteTime).toBe(quote.quoteTime);expect(updated.source).toBe(quote.source);
    expect(saved).toHaveLength(1);
  });
  it("can still fetch SENSEX and index fallbacks when NSE is unavailable",async()=>{
    const poller=new ReferencePoller({load:async()=>[],save:async()=>{}},async url=>{
      if(url.includes("nseindia"))throw new Error("NSE unavailable");
      if(url.includes("yahoo"))return {chart:{result:[{meta:{regularMarketPrice:24000,regularMarketTime:start/1000}}]}};
      return [];
    },()=>start,()=>0);
    await poller.poll();expect(poller.get("NIFTY50")!.source).toContain("Yahoo");expect(poller.get("SENSEX")!.source).toContain("Yahoo");
  });
});
