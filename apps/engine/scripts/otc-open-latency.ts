/**
 * Measures OTC trade-open latency through the engine's HTTP endpoint while the
 * production cadence runs (1 s advance, 30 s checkpoint) and chart viewers are
 * connected. The world is first aged so its checkpoint is production-sized.
 * Isolated local database only.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:5433/otc_integration \
 *   pnpm --filter @asm/engine exec tsx scripts/otc-open-latency.ts [trades=60] [viewers=20] [warmHours=26]
 */
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { prisma,marketReferenceRepository } from "@asm/db";
import { MULTI_MARKETS } from "@asm/market-sim";
import { OtcRuntime } from "../src/otc/runtime";
import { createOtcHttp } from "../src/otc/http";
import { OtcWebSocketServer } from "../src/otc/websocket";

const url=new URL(process.env.DATABASE_URL??"");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/otc_integration")throw new Error("Isolated 127.0.0.1/otc_integration database required");
const trades=Number(process.argv[2]??60),viewers=Number(process.argv[3]??20),warmHours=Number(process.argv[4]??26);
const pct=(xs:number[],p:number)=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]!:NaN;};
const summary=(xs:number[])=>`n=${xs.length} p50=${pct(xs,.5).toFixed(1)} p90=${pct(xs,.9).toFixed(1)} max=${Math.max(...xs).toFixed(1)} ms`;

await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});
await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});await prisma.marketReferencePoll.deleteMany();
await prisma.marketReferenceAudit.deleteMany();await prisma.marketReference.deleteMany();
const born=Date.now()-warmHours*3600000;
for(const m of MULTI_MARKETS)await marketReferenceRepository(prisma).save({symbol:m.symbol,price:m.base,quoteTime:born,receivedAt:born,
  source:"Benchmark fixture",url:"fixture://frozen",kind:"PUBLIC_QUOTE",minuteBps:m.minuteBps,calibration:"Frozen benchmark input",sampleBars:0,session:"UNKNOWN"});
await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});

const runtime=new OtcRuntime(prisma,process.env.DATABASE_URL!);
await runtime.start(born);
console.log(`aging the world by ${warmHours} h…`);
await runtime.advance(Date.now());await runtime.checkpoint();
const [{bytes}]=await prisma.$queryRaw<{bytes:number}[]>`SELECT octet_length("state"::text)::int AS bytes FROM "MarketWorldCheckpoint" WHERE "id"='otc-main'`;
console.log(`checkpoint size ${(bytes/1e6).toFixed(1)} MB`);

let advancing=false,checkpointing=false;
const timers=[
  setInterval(()=>{if(advancing)return;advancing=true;void runtime.advance().finally(()=>{advancing=false;});},1000),
  setInterval(()=>{if(checkpointing)return;checkpointing=true;void runtime.checkpoint().finally(()=>{checkpointing=false;});},30000),
];
const secret="benchmark-secret-at-least-16-chars",http=createOtcHttp(runtime,secret,0),port=await http.listen();
const user=await prisma.user.create({data:{email:`latency-${randomUUID()}@test.invalid`,passwordHash:"benchmark-only",liveAccess:true}});
const account=await prisma.account.create({data:{userId:user.id,type:"LIVE",currency:"INR",realBalance:1_000_000_000}});
const sockets=new OtcWebSocketServer(runtime,0,async()=>randomUUID());await sockets.ready;
const clients:WebSocket[]=[];
for(let i=0;i<viewers;i++){
  const ws=new WebSocket(`ws://127.0.0.1:${sockets.port()}`);clients.push(ws);
  await new Promise(resolve=>ws.once("message",resolve));
  ws.send(JSON.stringify({type:"auth",token:"x"}));
  ws.send(JSON.stringify({type:"subscribe",symbol:MULTI_MARKETS[i%MULTI_MARKETS.length]!.symbol,timeframe:"1m"}));
  ws.send(JSON.stringify({type:"watchlist:subscribe",symbols:MULTI_MARKETS.slice(0,10).map(m=>m.symbol)}));
}
await wait(3000);

const endpoint=`http://127.0.0.1:${port}/otc/trades`,headers={Authorization:`Bearer ${secret}`,"Content-Type":"application/json"};
const statuses:Record<number,number>={};
async function open(token:string){
  const started=performance.now();
  const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60,
    accountId:account.id,actorId:user.id,idempotencyKey:randomUUID(),quoteToken:token})});
  const text=await response.text();if(response.status!==201&&response.status!==409)throw new Error(`open status ${response.status}: ${text}; runtime failure: ${(()=>{const f=(runtime as unknown as {failure:{message?:string;code?:string;meta?:unknown}|null}).failure;return f?`${f.code} ${JSON.stringify(f.meta)} ${f.message}`:"none";})()}`);
  statuses[response.status]=(statuses[response.status]??0)+1;
  return performance.now()-started;
}
const loop=monitorEventLoopDelay({resolution:10});loop.enable();
const random:number[]=[];
for(let i=0;i<trades;i++){const token=(await runtime.snapshot("BTCUSDT")).displayQuote!.token;await wait(300+Math.random()*1200);random.push(await open(token));}
const loopRandom={p99:loop.percentile(99)/1e6,max:loop.max/1e6};loop.reset();
// Worst case: a trade that arrives just after a checkpoint starts.
const during:number[]=[],checkpointMs:number[]=[];
for(let i=0;i<10;i++){
  while(checkpointing)await wait(20);
  const token=(await runtime.snapshot("BTCUSDT")).displayQuote!.token;
  checkpointing=true;const began=performance.now();
  const saved=runtime.checkpoint().then(()=>checkpointMs.push(performance.now()-began)).finally(()=>{checkpointing=false;});
  await wait(5);during.push(await open(token));await saved;await wait(500);
}
const loopDuring={p99:loop.percentile(99)/1e6,max:loop.max/1e6};

console.log(`\nopen at random times:          ${summary(random)}`);
console.log(`open just after a checkpoint:  ${summary(during)}`);
console.log(`responses: ${JSON.stringify(statuses)} (409 = business rejection, same queue path)`);
console.log(`checkpoint (call to durable):  ${summary(checkpointMs)}`);
console.log(`main-thread stalls, random phase:     p99=${loopRandom.p99.toFixed(0)} max=${loopRandom.max.toFixed(0)} ms`);
console.log(`main-thread stalls, checkpoint phase: p99=${loopDuring.p99.toFixed(0)} max=${loopDuring.max.toFixed(0)} ms`);
for(const t of timers)clearInterval(t);
for(const ws of clients)ws.close();
await sockets.stop();await http.close();await runtime.stop(false);
await prisma.trade.deleteMany({where:{accountId:account.id}});await prisma.transaction.deleteMany({where:{accountId:account.id}});
await prisma.account.delete({where:{id:account.id}}).catch(()=>{});await prisma.user.delete({where:{id:user.id}}).catch(()=>{});
await prisma.$disconnect();process.exit(0);
