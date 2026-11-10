import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { MarketWorld,type OpenContractResult } from "@asm/market-sim";
import { prisma } from "../client";
import { reserveOtcTrade,finalizeOtcOpen,settleOtcTrade,type OtcOpenIntent } from "./otc-trade";
import { convertAccountCurrency } from "./account";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL),users:string[]=[];
async function fixture(balance=100000,bonus=0){
  const user=await prisma.user.create({data:{email:`otc-${randomUUID()}@test.invalid`,passwordHash:"test-only",liveAccess:true}});users.push(user.id);
  const live=await prisma.account.create({data:{userId:user.id,type:"LIVE",realBalance:balance,bonusBalance:bonus,currency:"INR"}});
  const demo=await prisma.account.create({data:{userId:user.id,type:"DEMO",realBalance:balance,currency:"INR"}});
  return {user,live,demo};
}
describe.skipIf(!enabled)("OTC ledger against isolated Postgres",()=>{
  beforeAll(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Refusing non-isolated OTC test database");
    await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});
  });
  afterAll(async()=>{await prisma.marketCommand.deleteMany({where:{actorId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();});
  it("reserves once, finalizes once and settles once through the actual world",async()=>{
    const f=await fixture(),world=new MarketWorld(Date.now()),request={actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP" as const,stake:10000,durationSec:60};
    const command=await reserveOtcTrade(request,prisma,world.time),intent=command.input as unknown as OtcOpenIntent;
    expect(intent.contract).toMatchObject({role:"USER",accountType:"LIVE"});
    expect((await reserveOtcTrade(request)).id).toBe(command.id);
    expect((await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).realBalance).toBe(90000);
    const result=world.open(intent.contract);expect(result.filledLots).toBeGreaterThan(0);
    await finalizeOtcOpen(command.id,result);await finalizeOtcOpen(command.id,result);
    world.advance(world.time+60000);const p=world.contracts.get(command.id)!;
    await settleOtcTrade(p);await settleOtcTrade(p);
    const account=await prisma.account.findUniqueOrThrow({where:{id:f.live.id}});
    expect(account.realBalance).toBe(90000+p.credit);
    const ledger=await prisma.transaction.findMany({where:{accountId:f.live.id}});
    expect(ledger.filter(r=>r.kind==="TRADE_STAKE")).toHaveLength(1);
    expect(ledger.reduce((n,r)=>n+r.amount,100000)).toBe(account.realBalance+account.bonusBalance);
    expect((await prisma.trade.findUniqueOrThrow({where:{id:command.id}})).mode).toBe("OTC_FIXED");
  });
  it("rejects a stale mobile currency inside the reservation lock without debiting",async()=>{
    const f=await fixture(),request={actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP" as const,stake:10000,durationSec:60,currency:"INR"};
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"USD"});
    const before=await prisma.account.findUniqueOrThrow({where:{id:f.live.id}});
    await expect(reserveOtcTrade(request)).rejects.toThrow("currency_changed");
    expect(await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).toMatchObject({currency:"USD",realBalance:before.realBalance,bonusBalance:before.bonusBalance});
    expect(await prisma.marketCommand.count({where:{accountId:f.live.id}})).toBe(0);
    expect(await prisma.transaction.count({where:{accountId:f.live.id,kind:"TRADE_STAKE"}})).toBe(0);
  });
  it("does not overspend when simultaneous requests compete for one balance",async()=>{
    const f=await fixture(10000);
    const results=await Promise.allSettled(Array.from({length:10},()=>reserveOtcTrade({actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60})));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).realBalance).toBe(0);
    expect(await prisma.transaction.count({where:{accountId:f.live.id,kind:"TRADE_STAKE"}})).toBe(1);
  });
  it("refunds a rejected book order to its original real/bonus split exactly once",async()=>{
    const f=await fixture(6000,6000),command=await reserveOtcTrade({actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"DOWN",stake:10000,durationSec:60});
    await finalizeOtcOpen(command.id,null,"liquidity_unavailable");await finalizeOtcOpen(command.id,null);
    expect(await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).toMatchObject({realBalance:6000,bonusBalance:6000});
    expect(await prisma.transaction.count({where:{accountId:f.live.id,kind:"TRADE_REFUND"}})).toBe(1);
  });
  it("derives DEMO paper flow from stored identity and protects account ownership",async()=>{
    const f=await fixture(),other=await fixture(),world=new MarketWorld(Date.now());
    const request={actorId:f.user.id,accountId:f.demo.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP" as const,stake:10000,durationSec:60};
    await expect(reserveOtcTrade({...request,actorId:other.user.id})).rejects.toThrow("account_not_found");
    const command=await reserveOtcTrade(request),intent=command.input as unknown as OtcOpenIntent;
    expect(intent.contract.accountType).toBe("DEMO");const before=world.checkpoint().markets;
    const result=world.open(intent.contract);expect(result.flowLots).toBe(0);expect(world.checkpoint().markets).toEqual(before);
    await finalizeOtcOpen(command.id,result);
    await expect(reserveOtcTrade({...request,direction:"DOWN"})).rejects.toThrow("idempotency_conflict");
  });
  it("rejects a tampered payout without changing a trade or balance",async()=>{
    const f=await fixture(),world=new MarketWorld(Date.now()),command=await reserveOtcTrade({actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60});
    const input=(command.input as unknown as OtcOpenIntent).contract,result:OpenContractResult=world.open(input);await finalizeOtcOpen(command.id,result);
    world.advance(world.time+60000);const p=world.contracts.get(command.id)!;
    await expect(settleOtcTrade({...p,credit:999999})).rejects.toThrow("payout mismatch");
    expect((await prisma.trade.findUniqueOrThrow({where:{id:command.id}})).status).toBe("OPEN");
    expect((await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).realBalance).toBe(90000);
  });
  it("keeps opening-currency terms while a pending/open contract changes account rail",async()=>{
    const f=await fixture(),world=new MarketWorld(Date.now()),command=await reserveOtcTrade({actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP",stake:10000,durationSec:60},prisma,world.time);
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"USD"});
    const result=world.open((command.input as unknown as OtcOpenIntent).contract),trade=await finalizeOtcOpen(command.id,result);
    expect(trade).toMatchObject({currency:"INR",stake:10000});
    // Switching again while OPEN must not rewrite the worker's fixed terms.
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"INR"});
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"USD"});
    world.advance(world.time+60000);const p=world.contracts.get(command.id)!;await settleOtcTrade(p);
    expect(await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).toMatchObject({currency:"USD",realBalance:900+p.credit/100});
    expect(await prisma.trade.findUniqueOrThrow({where:{id:command.id}})).toMatchObject({currency:"INR",stake:10000,pnl:p.pnl});
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"INR"});await settleOtcTrade(p);
    expect((await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).realBalance).toBe(90000+p.credit);
  });
  it("refunds a pending rejection in the new currency without changing real/bonus proportions",async()=>{
    const f=await fixture(6000,6000),command=await reserveOtcTrade({actorId:f.user.id,accountId:f.live.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"DOWN",stake:10000,durationSec:60});
    await convertAccountCurrency({actorId:f.user.id,accountId:f.live.id,currency:"USD"});
    await finalizeOtcOpen(command.id,null,"Liquidity unavailable");await finalizeOtcOpen(command.id,null);
    expect(await prisma.account.findUniqueOrThrow({where:{id:f.live.id}})).toMatchObject({currency:"USD",realBalance:60,bonusBalance:60});
  });
});
