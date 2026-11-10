import { expect,it } from "vitest";
import { MarketWorld,type OpenContractCommand } from "@asm/market-sim";
import { OtcWorker } from "./worker";
import { createHash } from "node:crypto";
const start=Date.parse("2026-11-05T10:00:00Z");
it("runs all 30 books and fixed contracts identically in the background worker",async()=>{
  const direct=new MarketWorld(start),worker=new OtcWorker({start});
  const observed:{symbol:string;sequence:number}[]=[];
  direct.observeExecutions((symbol,fill)=>observed.push({symbol,sequence:fill.sequence}));
  try{
    await worker.ready;
    const input:OpenContractCommand={id:"position-1",accountId:"a",actorId:"u",role:"USER",accountType:"LIVE",symbol:"BTCUSDT",stake:10000,stakeInrMinor:10000,direction:"UP",durationSec:60};
    expect(await worker.open(input)).toEqual(direct.open(input));
    await worker.advance(start+3600000);direct.advance(start+3600000);
    expect(await worker.checkpoint()).toEqual(direct.checkpoint());
    expect(await worker.settlements()).toEqual(direct.contracts.pendingSettlements());
    expect(await worker.leaderboard()).toEqual(direct.leaderboard());
    const audit=await worker.archive();
    // Worker yields between minute chunks; independent markets may interleave.
    // Each market must retain exactly the same ordered executions.
    const digest=(rows:{symbol:string;sequence:number}[])=>createHash("sha256").update(JSON.stringify(rows.map(({symbol,sequence})=>({symbol,sequence})).sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.sequence-b.sequence))).digest("hex");
    expect(audit.executions).toHaveLength(observed.length);
    expect(digest(audit.executions)).toBe(digest(observed));
    expect(audit.candles).toEqual([...direct.markets].flatMap(([symbol,m])=>m.closedCandlesAfter().map(b=>({symbol,...b}))));
    expect(await worker.archive()).toEqual({candles:[],executions:[]});
    const state=await worker.checkpoint(),resumed=new OtcWorker({start,checkpoint:state});
    try{await resumed.ready;expect(await resumed.checkpoint()).toEqual(state);await resumed.advance(start+3660000);direct.advance(start+3660000);expect(await resumed.checkpoint()).toEqual(direct.checkpoint());}finally{await resumed.stop();}
  }finally{await worker.stop();}
},20000);
it("rejects requests after worker shutdown rather than leaving them pending",async()=>{
  const worker=new OtcWorker({start});await worker.ready;await worker.stop();
  await expect(worker.snapshot("BTCUSDT")).rejects.toThrow("exited");
});
