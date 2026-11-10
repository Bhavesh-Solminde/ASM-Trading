import { afterAll,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { prisma } from "@asm/db";
import type { ServerMessage,OtcMarketMessage,OpenTradeResult } from "@asm/contracts";
import { OtcRuntime } from "./runtime";
import { createOtcHttp } from "./http";
import { OtcWebSocketServer } from "./websocket";
import { seedTestReferences } from "./fixtures";
const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL);
async function until(predicate:()=>boolean){const end=Date.now()+6000;while(!predicate()){if(Date.now()>end)throw new Error("Transport test timed out");await wait(10);}}
describe.skipIf(!enabled)("authenticated OTC transports",()=>{
  afterAll(async()=>{vi.unstubAllEnvs();await prisma.$disconnect();});
  it.each([
    { role: "USER", accountType: "LIVE" },
    { role: "AFFILIATE", accountType: "LIVE" },
    { role: "AFFILIATE", accountType: "DEMO" },
  ] as const)("$role $accountType opens via HTTP, streams private trade events and exposes only sanitized market data",async ({ role, accountType })=>{
    vi.stubEnv("NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED",undefined);
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(url.hostname!=="127.0.0.1"||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Isolated transport database required");
    await prisma.marketExecution.deleteMany({where:{worldId:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});
    await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});
    await seedTestReferences(prisma);
    await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});
    // A normal signup has the historical liveAccess flag unset.
    const user=await prisma.user.create({data:{email:`transport-${randomUUID()}@test.invalid`,passwordHash:"test-only",role}});
    const account=await prisma.account.create({data:{userId:user.id,type:accountType,realBalance:100000,currency:"INR"}});
    const runtime=await new OtcRuntime(prisma,process.env.OTC_TEST_DATABASE_URL!).start();
    const secret="test-transport-secret-at-least-16",http=createOtcHttp(runtime,secret,0),port=await http.listen();
    const observerId=randomUUID();
    const settlements: string[]=[];
    const sockets=new OtcWebSocketServer(runtime,0,async ticket=>ticket==="valid-once"?user.id:ticket==="observer"?observerId:null,(actor,trade)=>{settlements.push(`${actor}:${trade.id}`);});await sockets.ready;
    const ws=new WebSocket(`ws://127.0.0.1:${sockets.port()}`),messages:ServerMessage[]=[];ws.on("message",raw=>messages.push(JSON.parse(String(raw))));
    const observer=new WebSocket(`ws://127.0.0.1:${sockets.port()}`),observed:ServerMessage[]=[];
    observer.on("message",raw=>observed.push(JSON.parse(String(raw))));
    try{
      const endpoint=`http://127.0.0.1:${port}/otc/trades`,body={symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60,accountId:account.id,actorId:user.id,idempotencyKey:randomUUID(),quoteToken:(await runtime.snapshot("BTCUSDT")).displayQuote!.token};
      expect((await fetch(endpoint,{method:"POST"})).status).toBe(401);
      const headers={Authorization:`Bearer ${secret}`,"Content-Type":"application/json"};
      expect((await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({...body,role:"ADMIN"})})).status).toBe(400);
      await until(()=>messages.some(m=>m.type==="ready"));ws.send(JSON.stringify({type:"auth",token:"valid-once"}));await until(()=>messages.some(m=>m.type==="authed"));
      ws.send(JSON.stringify({type:"subscribe",symbol:"BTCUSDT",timeframe:"1m"}));ws.send(JSON.stringify({type:"watchlist:subscribe",symbols:["BTCUSDT","EURUSD"]}));
      await until(()=>messages.some(m=>m.type==="otc:market"));
      await until(()=>observed.some(m=>m.type==="ready"));observer.send(JSON.stringify({type:"auth",token:"observer"}));await until(()=>observed.some(m=>m.type==="authed"));
      const initial=messages.find((m):m is OtcMarketMessage=>m.type==="otc:market")!;
      ws.send(JSON.stringify({type:"subscribe",symbol:"BTCUSDT",timeframe:"1m",generation:runtime.generation,since:initial.candles.at(-1)!.openTs}));
      await until(()=>messages.some(m=>m.type==="otc:market"&&!m.reset));
      const delta=messages.find((m):m is OtcMarketMessage=>m.type==="otc:market"&&!m.reset)!;
      expect(Buffer.byteLength(JSON.stringify(delta))).toBeLessThan(Buffer.byteLength(JSON.stringify(initial)));
      const beforeReset=messages.length;ws.send(JSON.stringify({type:"subscribe",symbol:"BTCUSDT",timeframe:"5m",generation:"old-worker",since:0}));
      await until(()=>messages.slice(beforeReset).some(m=>m.type==="otc:market"&&m.timeframe==="5m"&&m.reset));
      const olderStart=messages.length;ws.send(JSON.stringify({type:"candles:loadOlder",symbol:"BTCUSDT",timeframe:"1m",before:initial.candles.at(-1)!.openTs,limit:10}));
      await until(()=>messages.slice(olderStart).some(m=>m.type==="candles:older"));
      expect(messages.slice(olderStart).find(m=>m.type==="candles:older")!.candles).toHaveLength(10);
      const displayed=messages.filter((m):m is OtcMarketMessage=>m.type==="otc:market").at(-1)!.displayQuote!;
      body.quoteToken=displayed.token;
      expect((await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({...body,quoteToken:randomUUID()})})).status).toBe(409);
      expect(await prisma.transaction.count({where:{accountId:account.id,kind:"TRADE_STAKE"}})).toBe(0);
      await runtime.advance(Date.now()+1500);
      const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body)});expect(response.status).toBe(201);
      const opened=await response.json() as OpenTradeResult;expect(opened.trade.mode).toBe("OTC_FIXED");expect(opened.balances.realBalance).toBe(90000);
      if(role==="USER")expect(opened.trade.filledLots).toBeGreaterThan(0);
      else {
        expect(opened.trade.filledLots).toBe(0);
        expect((await runtime.openTobs()).BTCUSDT??0).toBe(0);
      }
      expect(opened.trade.entryPrice).toBe(displayed.price);
      await until(()=>messages.some(m=>m.type==="trade:opened"));
      await runtime.advance(Date.now()+120000);await until(()=>messages.some(m=>m.type==="trade:settled"));
      expect(settlements).toContain(`${user.id}:${opened.trade.id}`);
      await until(()=>messages.some(m=>m.type==="otc:bots"));
      const publicMessages=messages.filter((m):m is OtcMarketMessage=>m.type==="otc:market");
      expect(JSON.stringify(publicMessages)).not.toContain(user.id);expect(JSON.stringify(publicMessages)).not.toContain("makerId");
      expect(messages.find(m=>m.type==="otc:bots")!.rows).toHaveLength(10);
      expect(observed.some(m=>m.type==="trade:opened"||m.type==="trade:settled"||m.type==="balance:update")).toBe(false);
      const metricsResponse=await fetch(`http://127.0.0.1:${port}/otc/metrics`,{headers});expect(metricsResponse.status).toBe(200);
      const unauth=new WebSocket(`ws://127.0.0.1:${sockets.port()}`),closed=new Promise<number>(resolve=>unauth.once("close",resolve));
      unauth.on("open",()=>unauth.send(JSON.stringify({type:"subscribe",symbol:"BTCUSDT",timeframe:"1m"})));expect(await closed).toBe(1008);
      expect((await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body)})).status).toBe(201);
      expect(await prisma.transaction.count({where:{accountId:account.id,kind:"TRADE_STAKE"}})).toBe(1);
    }finally{
      ws.close();observer.close();await sockets.stop();await http.close();await runtime.stop();
      await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});await prisma.user.delete({where:{id:user.id}});
      await prisma.marketExecution.deleteMany({where:{worldId:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});
    }
  },20000);
});
