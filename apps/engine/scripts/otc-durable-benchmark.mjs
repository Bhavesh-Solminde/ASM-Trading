import { performance,monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { prisma } from "@asm/db";
import { OtcRuntime } from "../src/otc/runtime.ts";
import { createOtcHttp } from "../src/otc/http.ts";
import { seedTestReferences } from "../src/otc/fixtures.ts";
const database=new URL(process.env.DATABASE_URL??"");
const container=process.env.OTC_STAGING_PROJECT==="asmtrader-otc-staging"&&database.hostname==="postgres"&&database.port==="5432"&&database.username==="otc_stage"&&database.pathname==="/otc_benchmark";
const local=database.hostname==="127.0.0.1"&&database.port==="55441"&&database.pathname==="/otc_integration";
if(process.env.OTC_STAGING_RUN!=="true"||(!container&&!local))throw new Error("Disposable regression database on 55441 or named staging otc_benchmark database required");
const output=resolve(container?"/tmp/otc-reports":"../../docs/verification");
const delay=monitorEventLoopDelay({resolution:20}),latencies=[],healthErrors=[];let runtime,http,timer,busy=false;
try{
  for(const table of [prisma.marketCommand,prisma.marketExecution,prisma.otcCandle])await table.deleteMany({where:{worldId:"otc-main"}});
  await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});
  await seedTestReferences(prisma);
  runtime=await new OtcRuntime(prisma,process.env.DATABASE_URL).start();
  const secret="isolated-benchmark-only-secret",endpoint=createOtcHttp(runtime,secret,0);http=endpoint;const port=await endpoint.listen();
  const summaries=await runtime.summaries(),start=(await runtime.snapshot("BTCUSDT")).time,began=performance.now(),cpu=process.cpuUsage();
  delay.enable();
  timer=setInterval(async()=>{if(busy)return;busy=true;try{
    const sent=performance.now(),response=await fetch(`http://127.0.0.1:${port}/otc/health`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(5000)});
    if(response.status!==200)throw new Error("Health unavailable under fast-forward");await response.json();latencies.push(performance.now()-sent);
  }catch(error){healthErrors.push(error instanceof Error?error.message:String(error));}finally{busy=false;}},100);
  for(let minute=1;minute<=60;minute++){
    await wait(Math.max(0,minute*200-(performance.now()-began)));await runtime.advance(start+minute*60000);
    if(minute%15===0){await runtime.checkpoint();console.log(`Durable 300x: ${minute}/60 minutes`);}
  }
  clearInterval(timer);timer=null;while(busy)await wait(10);
  const elapsedMs=performance.now()-began,used=process.cpuUsage(cpu),after=await runtime.summaries(),snapshot=await runtime.snapshot("BTCUSDT");
  const executions=await prisma.marketExecution.count({where:{worldId:"otc-main"}}),expected=after.reduce((n,m,i)=>n+m.fills-summaries[i].fills,0);
  if(executions!==expected)throw new Error("Durable execution audit omitted or duplicated fills");
  await runtime.checkpoint();await runtime.stop(false);runtime=await new OtcRuntime(prisma,process.env.DATABASE_URL).start();
  const exactRestart=isDeepStrictEqual(await runtime.snapshot("BTCUSDT"),snapshot);if(!exactRestart)throw new Error("Durable benchmark restart diverged");
  const sorted=[...latencies].sort((a,b)=>a-b),metrics={scope:`Actual ${container?"isolated KVM staging":"local"} durable coordinator, worker, checkpoint/archive persistence and authenticated HTTP. Process CPU/RSS exclude the separate Postgres process, web, Redis and browser.`,
    markets:30,bots:6000,simulationMs:3600000,elapsedMs,achievedSpeed:3600000/elapsedMs,cpuOneCorePct:(used.user+used.system)/(elapsedMs*1000)*100,rssBytes:process.memoryUsage().rss,
    eventLoopP95Ms:delay.percentile(95)/1e6,eventLoopMaxMs:delay.max/1e6,healthRequests:latencies.length,healthP95Ms:sorted[Math.floor(sorted.length*.95)]??null,healthMaxMs:sorted.at(-1)??null,
    executions,expected,exactRestart,healthErrors,healthLatenciesMs:latencies};
  await mkdir(output,{recursive:true});await writeFile(resolve(output,"otc-durable-benchmark.json"),JSON.stringify(metrics,null,2));console.log(JSON.stringify({...metrics,healthLatenciesMs:undefined}));
  if(healthErrors.length)throw new Error("Authenticated HTTP failed during durable playback; see saved report");
}finally{if(timer)clearInterval(timer);while(busy)await wait(10);delay.disable();await http?.close();await runtime?.stop(false);await prisma.$disconnect();}
