import { monitorEventLoopDelay,performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { OtcWorker } from "../src/otc/worker.ts";

const start=Date.parse("2026-11-05T10:00:00Z"),worker=new OtcWorker({start}),stages=[],hash=createHash("sha256");
const delay=monitorEventLoopDelay({resolution:20});delay.enable();
let time=start,executionCount=0,closedCount=0,maxRss=0;
const volumes=new Map();let volumeChecks=0;
async function step(end){
  await worker.advance(end);time=end;const archive=await worker.archive();
  executionCount+=archive.executions.length;closedCount+=archive.candles.length;
  for(const row of archive.executions){hash.update(`${row.symbol}:${row.sequence}:${row.time}:${row.price}:${row.quantity}\n`);
    const key=`${row.symbol}:${Math.floor(row.time/60000)*60}`;volumes.set(key,(volumes.get(key)??0)+row.quantity);}
  for(const bar of archive.candles){const key=`${bar.symbol}:${bar.time}`;if((volumes.get(key)??0)!==bar.volume)throw new Error("Closed candle volume differs from actual matched quantities");volumes.delete(key);volumeChecks++;}
  maxRss=Math.max(maxRss,process.memoryUsage().rss);
}
async function stage(name,operation){
  delay.reset();const before=process.cpuUsage(),began=performance.now(),initialTime=time;
  await operation();const elapsedMs=performance.now()-began,cpu=process.cpuUsage(before);
  const result={name,elapsedMs,simulationMs:time-initialTime,cpuOneCorePct:(cpu.user+cpu.system)/(elapsedMs*1000)*100,rssBytes:process.memoryUsage().rss,maxRssBytes:maxRss,
    eventLoopP95Ms:delay.percentile(95)/1e6,eventLoopMaxMs:delay.max/1e6};stages.push(result);console.log(JSON.stringify(result));
}
try{
  await worker.ready;await worker.archive();
  const initial=await worker.checkpoint();for(const m of initial.markets){const forming=m.candles.at(-1);if(forming)volumes.set(`${m.profile.symbol}:${forming.time}`,forming.volume);}
  await stage("Normal-speed scheduling, 10 seconds",async()=>{
    const began=performance.now(),initial=time;for(let i=1;i<=10;i++){await wait(Math.max(0,i*1000-(performance.now()-began)));await step(initial+i*1000);await worker.snapshot("BTCUSDT");}
  });
  await stage("300x playback, one simulation hour, all ticks retained",async()=>{
    const began=performance.now(),initial=time;
    for(let minute=1;minute<=60;minute++){await wait(Math.max(0,minute*200-(performance.now()-began)));await step(initial+minute*60000);}
  });
  await stage("Long session, 36 simulation hours with bounded archive drains",async()=>{
    const end=time+36*3600000;let checkpointHour=0;
    while(time<end){await step(Math.min(end,time+60000));const hour=Math.floor((time-(end-36*3600000))/3600000);if(hour>checkpointHour){checkpointHour=hour;if(hour%6===0)console.log(`Long session: ${hour}/36 hours`);}}
  });
  const state=await worker.checkpoint();
  if(state.markets.length!==30||state.markets.some(m=>m.candles.length>1500))throw new Error("World history buffer grew beyond its bound");
  for(const m of state.markets){
    const cash=m.book.wallets.reduce((n,w)=>n+BigInt(w.cash),0n),inventory=m.book.wallets.reduce((n,w)=>n+BigInt(w.inventory),0n);
    if(cash!==200n*1000000000000n||inventory!==200n*1000000n)throw new Error("Long-session book funding was not conserved");
    for(const w of m.book.wallets)if(![w.cash,w.inventory,w.reservedCash,w.reservedInventory].every(Number.isSafeInteger)||w.reservedCash>w.cash||w.reservedInventory>w.inventory||Math.min(w.cash,w.inventory,w.reservedCash,w.reservedInventory)<0)throw new Error("Long-session wallet exceeded its finite limits");
  }
  const resumed=new OtcWorker({start:time,checkpoint:JSON.parse(JSON.stringify(state))});
  let exactRestart=false;
  try{
    await resumed.ready;await worker.advance(time+60000);await resumed.advance(time+60000);
    exactRestart=JSON.stringify(await worker.checkpoint())===JSON.stringify(await resumed.checkpoint());
    if(!exactRestart)throw new Error("Long-session restart diverged");
  }finally{await resumed.stop();}
  const container=process.env.OTC_STAGING_PROJECT==="asmtrader-otc-staging",directory=resolve(container?"/tmp/otc-reports":"../../docs/verification");
  const output=resolve(directory,"otc-worker-benchmark.json");await mkdir(directory,{recursive:true});
  await writeFile(output,JSON.stringify({scope:`Actual ${container?"isolated KVM staging":"local"} Node worker benchmark with frozen illustrative references. Includes worker and benchmark host; excludes website, database, Redis and browser. No orders or ticks are skipped.`,
    markets:30,bots:6000,executionCount,closedCount,volumeChecks,conservedFunding:true,executionDigest:hash.digest("hex"),exactRestart,retainedCandles:state.markets.map(m=>({symbol:m.profile.symbol,count:m.candles.length})),stages},null,2));
  console.log("Saved worker benchmark and verified exact long-session restart.");
}finally{delay.disable();await worker.stop();}
