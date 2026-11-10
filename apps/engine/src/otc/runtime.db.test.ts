import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma,reserveOtcTrade } from "@asm/db";
import { OtcRuntime } from "./runtime";
import { startOtcService } from "./service";
import { assertLegacyDrained } from "./preflight";
import { seedTestReferences } from "./fixtures";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL),runtimes:OtcRuntime[]=[],users:string[]=[];
async function fixture(r:OtcRuntime){
  const user=await prisma.user.create({data:{email:`runtime-${randomUUID()}@test.invalid`,passwordHash:"test-only",liveAccess:true}});users.push(user.id);
  const account=await prisma.account.create({data:{userId:user.id,type:"LIVE",currency:"INR",realBalance:100000}});
  const quote=(await r.snapshot("BTCUSDT")).displayQuote!;
  return {actorId:user.id,accountId:account.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP" as const,stake:10000,durationSec:60,quoteToken:quote.token};
}
async function runtime(hook?:ConstructorParameters<typeof OtcRuntime>[2]){
  const r=new OtcRuntime(prisma,process.env.OTC_TEST_DATABASE_URL!,hook);runtimes.push(r);await r.start();return r;
}
describe.skipIf(!enabled)("durable OTC coordinator on isolated Postgres",()=>{
  beforeEach(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Refusing non-isolated runtime database");
    await prisma.marketExecution.deleteMany({where:{worldId:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});
    await prisma.marketReferencePoll.deleteMany();
    await seedTestReferences(prisma);
    await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});
    await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});
  });
  afterEach(async()=>{vi.restoreAllMocks();for(const r of runtimes.splice(0))await r.stop(false).catch(()=>{});await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});await prisma.marketExecution.deleteMany({where:{worldId:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});await prisma.user.deleteMany({where:{id:{in:users.splice(0)}}});});
  it("rejects an expired quote before reserving funds and accepts a fresh displayed quote",async()=>{
    const r=await runtime(),input=await fixture(r);
    const now=Date.now(),clock=vi.spyOn(Date,"now").mockReturnValue(now+6000);
    await expect(r.open(input)).rejects.toThrow("display_quote_expired");
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000);
    expect(await prisma.marketCommand.count({where:{idempotencyKey:input.idempotencyKey}})).toBe(0);
    const quote=(await r.snapshot("BTCUSDT")).displayQuote!;
    const opened=await r.open({...input,quoteToken:quote.token});
    expect(opened.entryPrice).toBe(quote.price);
    clock.mockReturnValue(now+20000);
    expect((await r.open({...input,quoteToken:quote.token})).id).toBe(opened.id);
  },20000);
  it("runs LIVE trades, persists state and restores the identical market",async()=>{
    const r=await runtime(),input=await fixture(r),trade=await r.open(input);
    expect(trade.mode).toBe("OTC_FIXED");expect(trade.filledLots).toBeGreaterThan(0);
    expect((await r.openTobs()).BTCUSDT).toBe(1);
    expect((await r.open(input)).id).toBe(trade.id);
    const snapshot=await r.snapshot("BTCUSDT");await r.checkpoint();await r.stop(false);
    const resumed=await runtime(),restored=await resumed.snapshot("BTCUSDT");
    expect({...restored,displayQuote:null}).toEqual({...snapshot,displayQuote:null});
    expect((await resumed.open(input)).id).toBe(trade.id);
    await resumed.advance(snapshot.time+120000);
    const settled=await prisma.trade.findUniqueOrThrow({where:{id:trade.id}});
    expect(settled.status).not.toBe("OPEN");
    expect((await resumed.openTobs()).BTCUSDT??0).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000+settled.pnl);
  },20000);
  it("refuses placeholder boot when any verified reference is missing",async()=>{
    await prisma.marketReference.delete({where:{symbol:"SOLUSDT"}});
    await expect(runtime()).rejects.toThrow("startup awaits verified references: SOLUSDT");
    expect(await prisma.marketWorldCheckpoint.findUnique({where:{id:"otc-main"}})).toBeNull();
    expect(await prisma.otcCandle.count({where:{worldId:"otc-main"}})).toBe(0);
  });
  it("seeds first history near the fetched price instead of the catalogue placeholder",async()=>{
    await prisma.marketReference.update({where:{symbol:"SOLUSDT"},data:{price:96.82}});
    const r=await runtime(),snapshot=await r.snapshot("SOLUSDT");
    expect(Math.abs(snapshot.market.candles[0]!.open/96.82-1)).toBeLessThan(.01);
    expect(Math.abs(snapshot.market.lastPrice!/96.82-1)).toBeLessThan(.05);
  },20000);
  it("refuses a new market seed when its durable checkpoint is missing",async()=>{
    const r=await runtime();await r.stop(false);
    const before=await prisma.otcCandle.count({where:{worldId:"otc-main"}});expect(before).toBeGreaterThan(0);
    await prisma.marketWorldCheckpoint.delete({where:{id:"otc-main"}});
    await expect(runtime()).rejects.toThrow("checkpoint missing while durable market history exists");
    expect(await prisma.marketWorldCheckpoint.findUnique({where:{id:"otc-main"}})).toBeNull();
    expect(await prisma.otcCandle.count({where:{worldId:"otc-main"}})).toBe(before);
  },20000);
  it("keeps legacy positions with their original engine before OTC activation",async()=>{
    const r=await runtime(),input=await fixture(r),trade=await r.open(input);
    await expect(assertLegacyDrained(prisma)).resolves.toBeUndefined();
    const legacy=await prisma.trade.create({data:{...trade,id:randomUUID(),mode:"CFD",marketCommandId:null,idempotencyKey:null}});
    await expect(assertLegacyDrained(prisma)).rejects.toThrow("legacy positions are still OPEN");
    await prisma.trade.update({where:{id:legacy.id},data:{status:"CLOSED"}});
    await expect(assertLegacyDrained(prisma)).resolves.toBeUndefined();
  },20000);
  it.each(["applied","finalized"] as const)("recovers a crash after %s without another stake or fill",async stage=>{
    let armed=true;
    const r=await runtime(async observed=>{if(armed&&observed===stage){armed=false;throw new Error("Injected crash");}});
    const input=await fixture(r);
    await expect(r.open(input)).rejects.toThrow("Injected crash");await r.stop(false);
    const resumed=await runtime(),trade=await resumed.open(input),snapshot=await resumed.snapshot("BTCUSDT");
    expect(trade.id).toBeTruthy();expect(snapshot.market.tobs.orders).toBe(1);
    expect(await prisma.transaction.count({where:{accountId:input.accountId,kind:"TRADE_STAKE"}})).toBe(1);
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(90000);
  },20000);
  it("recovers after credit but before settlement acknowledgement without double payout",async()=>{
    let armed=false;
    const r=await runtime(async stage=>{if(armed&&stage==="settled"){armed=false;throw new Error("Crash after credit");}});
    const input=await fixture(r);
    const trade=await r.open(input),snapshot=await r.snapshot("BTCUSDT");await r.checkpoint();armed=true;
    await expect(r.advance(snapshot.time+120000)).rejects.toThrow("Crash after credit");
    const before=await prisma.account.findUniqueOrThrow({where:{id:input.accountId}});await r.stop(false);
    const resumed=await runtime();await resumed.checkpoint();
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(before.realBalance);
    expect((await prisma.trade.findUniqueOrThrow({where:{id:trade.id}})).status).not.toBe("OPEN");
    expect(await prisma.transaction.count({where:{accountId:input.accountId,kind:"TRADE_PAYOUT"}})).toBeLessThanOrEqual(1);
  },20000);
  it("refuses a second writer and rejects a stale generation at the ledger",async()=>{
    const r=await runtime(),input=await fixture(r);
    const other=new OtcRuntime(prisma,process.env.OTC_TEST_DATABASE_URL!);await expect(other.start()).rejects.toThrow("writer lock");
    await expect(reserveOtcTrade(input,prisma,Date.now(),{worldId:"otc-main",generation:"stale"})).rejects.toThrow("fenced");
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000);
    await r.open(input);
  },20000);
  it("refunds invalid protection while keeping the coordinator usable",async()=>{
    const r=await runtime(),input=await fixture(r),before=await r.snapshot("BTCUSDT");
    await expect(r.open({...input,stopLoss:99999999})).rejects.toThrow("Invalid stop loss");
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000);
    const after=await r.snapshot("BTCUSDT");expect(after.market.tobs.orders).toBe(before.market.tobs.orders);
    await r.open({...input,idempotencyKey:randomUUID()});
  },20000);
  it("polls and persists real reference inputs without replacing executed candles",async()=>{
    const failures:unknown[]=[];
    await prisma.marketReferencePoll.create({data:{group:"crypto",attemptedAt:new Date(0),nextDueAt:new Date(0),failures:0}});
    const service=await startOtcService({client:prisma,databaseUrl:process.env.OTC_TEST_DATABASE_URL!,timers:false,onFatal:error=>failures.push(error),
      transport:async url=>{if(url.includes("ticker/price"))return [{symbol:"BTCUSDT",price:"81000"}];throw new Error("Other provider unavailable");}});
    try{
      runtimes.push(service.runtime);
      await service.runtime.advance(Date.now()+60000);
      const before=await service.runtime.snapshot("BTCUSDT");await service.poll();
      const after=await service.runtime.snapshot("BTCUSDT");
      expect(after.reference!.price).toBe(81000);expect(after.market.anchor.price).toBe(81000);
      expect(after.market.candles).toEqual(before.market.candles);expect(after.market.lastPrice).toBe(before.market.lastPrice);
      expect((await prisma.marketReference.findUniqueOrThrow({where:{symbol:"BTCUSDT"}})).price).toBe(81000);
      expect(failures).toEqual([]);
      expect((await prisma.marketReferencePoll.findUniqueOrThrow({where:{group:"crypto"}})).nextDueAt.getTime()).toBeGreaterThan(Date.now());
      await service.stop();
      const calls:string[]=[],resumed=await startOtcService({client:prisma,databaseUrl:process.env.OTC_TEST_DATABASE_URL!,timers:false,onFatal:error=>failures.push(error),transport:async url=>{calls.push(url);throw new Error("Must respect stored cooldown");}});
      try{await resumed.poll();expect(calls).toEqual([]);expect(resumed.poller.get("BTCUSDT")!.price).toBe(81000);}finally{await resumed.stop();}
    }finally{await service.stop();await prisma.marketReferenceAudit.deleteMany({where:{symbol:"BTCUSDT"}});await prisma.marketReference.deleteMany({where:{symbol:"BTCUSDT"}});}
  },20000);
});
