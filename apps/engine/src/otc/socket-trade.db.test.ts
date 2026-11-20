import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { prisma } from "@asm/db";
import { tradeRejectionMessage,type OtcMarketMessage,type ServerMessage } from "@asm/contracts";
import { OtcRuntime } from "./runtime";
import { OtcWebSocketServer } from "./websocket";
import { seedTestReferences } from "./fixtures";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL);
async function until(predicate:()=>boolean){const end=Date.now()+6000;while(!predicate()){if(Date.now()>end)throw new Error("Socket trade test timed out");await wait(10);}}

describe.skipIf(!enabled)("OTC trades over the engine socket",()=>{
  let runtime:OtcRuntime,sockets:OtcWebSocketServer|null=null,ws:WebSocket|null=null,allowed=true;
  const users:string[]=[];
  beforeEach(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(url.hostname!=="127.0.0.1"||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Isolated socket database required");
    await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});
    await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});await seedTestReferences(prisma);
    await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});
    allowed=true;runtime=await new OtcRuntime(prisma,process.env.OTC_TEST_DATABASE_URL!).start();
  });
  afterEach(async()=>{
    ws?.close();ws=null;await sockets?.stop();sockets=null;await runtime.stop(false);
    await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});
    await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});await prisma.user.deleteMany({where:{id:{in:users.splice(0)}}});
  });
  async function trader(){
    const user=await prisma.user.create({data:{email:`socket-${randomUUID()}@test.invalid`,passwordHash:"test-only"}});users.push(user.id);
    const account=await prisma.account.create({data:{userId:user.id,type:"LIVE",currency:"INR",realBalance:100000}});
    sockets=new OtcWebSocketServer(runtime,0,async ticket=>ticket==="ticket"?user.id:null,undefined,async()=>allowed);await sockets.ready;
    ws=new WebSocket(`ws://127.0.0.1:${sockets.port()}`);const messages:ServerMessage[]=[];ws.on("message",raw=>messages.push(JSON.parse(String(raw))));
    await until(()=>messages.some(m=>m.type==="ready"));ws.send(JSON.stringify({type:"auth",token:"ticket"}));await until(()=>messages.some(m=>m.type==="authed"));
    ws.send(JSON.stringify({type:"subscribe",symbol:"BTCUSDT",timeframe:"1m"}));
    await until(()=>messages.some(m=>m.type==="otc:market"&&!!m.displayQuote));
    const quote=()=>messages.filter((m):m is OtcMarketMessage=>m.type==="otc:market"&&!!m.displayQuote).at(-1)!.displayQuote!;
    const order=(key=randomUUID())=>({type:"trade:open",symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60,accountId:account.id,idempotencyKey:key,quoteToken:quote().token});
    const reply=async(key:string)=>{await until(()=>messages.some(m=>(m.type==="trade:open:result"||m.type==="trade:open:rejected")&&m.idempotencyKey===key));
      return messages.filter(m=>(m.type==="trade:open:result"||m.type==="trade:open:rejected")&&m.idempotencyKey===key).at(-1)!;};
    return {user,account,messages,quote,order,reply};
  }
  it("opens over the socket, answers with the trade and balance, and repeats the same trade for a retried key",async()=>{
    const {account,messages,quote,order,reply}=await trader();
    const shown=quote(),request=order();ws!.send(JSON.stringify(request));
    const result=await reply(request.idempotencyKey);
    if(result.type!=="trade:open:result")throw new Error(`expected a trade, got ${JSON.stringify(result)}`);
    expect(result.trade.mode).toBe("OTC_FIXED");expect(result.trade.entryPrice).toBe(shown.price);expect(result.balances.realBalance).toBe(90000);
    expect(messages.some(m=>m.type==="trade:opened"&&m.trade.id===result.trade.id)).toBe(true);
    const before=messages.length;ws!.send(JSON.stringify(request));
    await until(()=>messages.slice(before).some(m=>m.type==="trade:open:result"));
    const again=messages.slice(before).find(m=>m.type==="trade:open:result")!;
    expect(again.type==="trade:open:result"&&again.trade.id).toBe(result.trade.id);
    expect(await prisma.transaction.count({where:{accountId:account.id,kind:"TRADE_STAKE"}})).toBe(1);
  },20000);
  it("refuses a client-chosen actor, an expired price and a spent rate limit without opening anything",async()=>{
    const {user,account,messages,order,reply}=await trader();
    const before=messages.length;ws!.send(JSON.stringify({...order(),actorId:user.id}));
    await until(()=>messages.slice(before).some(m=>m.type==="error"));
    const stale={...order(),quoteToken:randomUUID()};ws!.send(JSON.stringify(stale));
    expect(await reply(stale.idempotencyKey)).toEqual({type:"trade:open:rejected",idempotencyKey:stale.idempotencyKey,code:"display_quote_expired",error:tradeRejectionMessage("display_quote_expired")});
    allowed=false;const limited=order();ws!.send(JSON.stringify(limited));
    expect(await reply(limited.idempotencyKey)).toMatchObject({type:"trade:open:rejected",code:"rate_limited"});
    expect(await prisma.transaction.count({where:{accountId:account.id,kind:"TRADE_STAKE"}})).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({where:{id:account.id}})).realBalance).toBe(100000);
    expect(ws!.readyState).toBe(WebSocket.OPEN);
  },20000);
});
