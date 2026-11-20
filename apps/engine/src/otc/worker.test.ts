import { expect,it } from "vitest";
import { MarketWorld,type OpenContractCommand } from "@asm/market-sim";
import { OtcWorker } from "./worker";
const start=Date.parse("2026-11-05T10:00:00Z");
it("runs all 30 books and fixed contracts identically in the background worker",async()=>{
  const direct=new MarketWorld(start),worker=new OtcWorker({start});
  try{
    await worker.ready;
    const input:OpenContractCommand={id:"position-1",accountId:"a",actorId:"u",role:"USER",accountType:"LIVE",symbol:"BTCUSDT",stake:10000,stakeInrMinor:10000,direction:"UP",durationSec:60};
    expect(await worker.open(input)).toEqual(direct.open(input));
    await worker.advance(start+3600000);direct.advance(start+3600000);
    expect(await worker.checkpoint()).toEqual(direct.checkpoint());
    expect(JSON.parse(await worker.checkpointJson())).toEqual(JSON.parse(JSON.stringify(direct.checkpoint({compact:true}))));
    expect(await worker.settlements()).toEqual(direct.contracts.pendingSettlements());
    expect(await worker.leaderboard()).toEqual(direct.leaderboard());
    const audit=await worker.archive();
    expect(audit.candles).toEqual([...direct.markets].flatMap(([symbol,m])=>m.closedCandlesAfter().map(b=>({symbol,...b}))));
    expect(await worker.archive()).toEqual({candles:[]});
    const state=await worker.checkpoint(),resumed=new OtcWorker({start,checkpoint:state});
    // The durable path: compact checkpoint plus the closed candles the host archived.
    const closed:Record<string,Omit<(typeof audit.candles)[number],"symbol">[]>={};
    for(const {symbol,...bar} of audit.candles)(closed[symbol]??=[]).push(bar);
    const compact=new OtcWorker({start,checkpoint:JSON.parse(await worker.checkpointJson()),closedCandles:closed});
    try{await compact.ready;expect(await compact.checkpoint()).toEqual(state);expect(await compact.snapshot("BTCUSDT")).toEqual(await worker.snapshot("BTCUSDT"));}
    finally{await compact.stop();}
    try{await resumed.ready;expect(await resumed.checkpoint()).toEqual(state);await resumed.advance(start+3660000);direct.advance(start+3660000);expect(await resumed.checkpoint()).toEqual(direct.checkpoint());}finally{await resumed.stop();}
  }finally{await worker.stop();}
},20000);
it("rejects requests after worker shutdown rather than leaving them pending",async()=>{
  const worker=new OtcWorker({start});await worker.ready;await worker.stop();
  await expect(worker.snapshot("BTCUSDT")).rejects.toThrow("exited");
});
