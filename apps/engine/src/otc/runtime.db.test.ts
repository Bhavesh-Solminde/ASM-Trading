import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma,reserveOtcTrade,type OtcStopsRequest } from "@asm/db";
import { MarketWorld, type SimulationCheckpoint } from "@asm/market-sim";
import { OtcRuntime } from "./runtime";
import { createOtcHttp } from "./http";
import { startOtcService } from "./service";
import { assertLegacyDrained } from "./preflight";
import { seedTestReferences } from "./fixtures";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL),runtimes:OtcRuntime[]=[],users:string[]=[];
async function fixture(r:OtcRuntime, type: "LIVE" | "DEMO" = "LIVE"){
  const user=await prisma.user.create({data:{email:`runtime-${randomUUID()}@test.invalid`,passwordHash:"test-only",liveAccess:true}});users.push(user.id);
  const account=await prisma.account.create({data:{userId:user.id,type,currency:"INR",realBalance:100000}});
  const quote=(await r.snapshot("BTCUSDT")).displayQuote!;
  return {actorId:user.id,accountId:account.id,idempotencyKey:randomUUID(),symbol:"BTCUSDT",direction:"UP" as const,stake:10000,durationSec:60,quoteToken:quote.token};
}
async function runtime(hook?:ConstructorParameters<typeof OtcRuntime>[2]){
  const r=new OtcRuntime(prisma,process.env.OTC_TEST_DATABASE_URL!,hook);runtimes.push(r);await r.start();return r;
}
async function freezeRuntimeClock(runtime: OtcRuntime) {
  const time = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(time);
  await runtime.advance(time);
  return clock;
}
describe.skipIf(!enabled)("durable OTC coordinator on isolated Postgres",()=>{
  beforeEach(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Refusing non-isolated runtime database");
    await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});
    await prisma.marketReferencePoll.deleteMany();
    await seedTestReferences(prisma);
    await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});
    await prisma.asset.upsert({where:{symbol:"BTCUSDT"},create:{symbol:"BTCUSDT",displayName:"BTC OTC",kind:"OTC",payoutPct:92,isOpen:true},update:{}});
  });
  afterEach(async()=>{vi.restoreAllMocks();for(const r of runtimes.splice(0))await r.stop(false).catch(()=>{});await prisma.marketCommand.deleteMany({where:{worldId:"otc-main"}});await prisma.marketWorldCheckpoint.deleteMany({where:{id:"otc-main"}});await prisma.otcCandle.deleteMany({where:{worldId:"otc-main"}});await prisma.user.deleteMany({where:{id:{in:users.splice(0)}}});});
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
    // Closed candles live in OtcCandle; the stored checkpoint keeps only each forming bar.
    const stored=(await prisma.marketWorldCheckpoint.findUniqueOrThrow({where:{id:"otc-main"}})).state as {markets:{candles:unknown[]}[]};
    expect(Math.max(...stored.markets.map(m=>m.candles.length))).toBeLessThanOrEqual(1);
    const resumed=await runtime(),restored=await resumed.snapshot("BTCUSDT");
    expect({...restored,displayQuote:null}).toEqual({...snapshot,displayQuote:null});
    expect((await resumed.open(input)).id).toBe(trade.id);
    await resumed.advance(snapshot.time+120000);
    const settled=await prisma.trade.findUniqueOrThrow({where:{id:trade.id}});
    expect(settled.status).not.toBe("OPEN");
    expect((await resumed.openTobs()).BTCUSDT??0).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000+settled.pnl);
  },20000);
  it("restores the identical market from a full checkpoint written before compact checkpoints",async()=>{
    const r=await runtime(),input=await fixture(r);await r.open(input);await r.checkpoint();
    // The first boot after this release reads the full state an older engine saved.
    const full=await (r as unknown as {worker:{checkpoint():Promise<{markets:{candles:unknown[]}[]}>}}).worker.checkpoint();
    expect(Math.max(...full.markets.map(m=>m.candles.length))).toBeGreaterThan(1);
    await prisma.$executeRaw`UPDATE "MarketWorldCheckpoint" SET "state"=${JSON.stringify(full)}::jsonb WHERE "id"='otc-main'`;
    const snapshot=await r.snapshot("BTCUSDT");await r.stop(false);
    const resumed=await runtime();
    expect({...await resumed.snapshot("BTCUSDT"),displayQuote:null}).toEqual({...snapshot,displayQuote:null});
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
  it("checkpoints and serves quotes while history cleanup is stalled",async()=>{
    const r=await runtime();await r.checkpoint();
    const blocker=new pg.Client({connectionString:process.env.OTC_TEST_DATABASE_URL});await blocker.connect();
    const within=<T,>(work:Promise<T>)=>Promise.race([work.then(()=>"served"),new Promise(resolve=>setTimeout(()=>resolve("blocked"),3000))]);
    try{
      await blocker.query("BEGIN");await blocker.query('LOCK TABLE "OtcCandle" IN ACCESS EXCLUSIVE MODE');
      const cleanup=r.retain();
      expect(await within(r.snapshot("BTCUSDT"))).toBe("served");
      expect(await within(r.checkpoint())).toBe("served");
      await blocker.query("ROLLBACK");
      await expect(cleanup).resolves.toEqual({commands:expect.any(Number),candles:0});
    }finally{await blocker.end();}
  },20000);
  it("reports a failed cleanup to its caller and keeps trading",async()=>{
    const r=await runtime(),input=await fixture(r);await r.checkpoint();
    const blocker=new pg.Client({connectionString:process.env.OTC_TEST_DATABASE_URL});await blocker.connect();
    try{
      await blocker.query("BEGIN");await blocker.query('LOCK TABLE "MarketCommand" IN SHARE MODE');
      await expect(r.retain({lockTimeoutMs:200})).rejects.toThrow();
    }finally{await blocker.query("ROLLBACK");await blocker.end();}
    const trade=await r.open({...input,quoteToken:(await r.snapshot("BTCUSDT")).displayQuote!.token});
    expect(trade.status).toBe("OPEN");
    await expect(r.retain()).resolves.toEqual({commands:expect.any(Number),candles:0});
  },20000);
  it("refunds invalid protection while keeping the coordinator usable",async()=>{
    const r=await runtime(),input=await fixture(r),before=await r.snapshot("BTCUSDT");
    await expect(r.open({...input,stopLoss:99999999})).rejects.toThrow("Invalid stop loss");
    expect((await prisma.account.findUniqueOrThrow({where:{id:input.accountId}})).realBalance).toBe(100000);
    const after=await r.snapshot("BTCUSDT");expect(after.market.tobs.orders).toBe(before.market.tobs.orders);
    await r.open({...input,idempotencyKey:randomUUID()});
  },20000);
  it("replays existing opens with stops and applies each stop request once, even after settlement", async () => {
    const r = await runtime();
    await freezeRuntimeClock(r);
    const input = await fixture(r);
    const entry = (await r.snapshot(input.symbol)).displayQuote!.price;
    const trade = await r.open({ ...input, stopLoss: entry * 0.5, takeProfit: entry * 2 });
    expect(trade).toMatchObject({ stopLoss: entry * 0.5, takeProfit: entry * 2 });
    const request = { tradeId: trade.id, actorId: input.actorId, requestId: randomUUID(), stopLoss: entry * 0.8, takeProfit: null };
    const first = await r.setStops(request);
    const cleared = await r.setStops({ ...request, requestId: randomUUID(), stopLoss: null });
    expect(first).toMatchObject({ stopLoss: request.stopLoss, takeProfit: null });
    expect(cleared).toMatchObject({ stopLoss: null, takeProfit: null });
    await expect(r.setStops({ ...request, stopLoss: null })).rejects.toThrow("not_found");
    await expect(r.setStops({ ...request, takeProfit: entry * 2 })).rejects.toThrow("not_found");
    expect(await r.setStops(request)).toEqual(first);
    const snapshot = await r.snapshot(input.symbol);
    await r.stop(false);
    const resumed = await runtime();
    expect({ ...await resumed.snapshot(input.symbol), displayQuote: null }).toEqual({ ...snapshot, displayQuote: null });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({ stopLoss: null, takeProfit: null });
    await resumed.advance(trade.expiryTs.getTime());
    expect(await resumed.setStops(request)).toEqual(first);
    const commands = await prisma.marketCommand.findMany({
      where: { accountId: input.accountId, idempotencyKey: { startsWith: "stops:" } }, orderBy: { sequence: "asc" },
    });
    expect(commands.map((row) => row.result)).toEqual([
      { change: { tradeId: trade.id, stopLoss: request.stopLoss, takeProfit: null, stopChanges: 1 }, trade: first },
      { change: { tradeId: trade.id, stopLoss: null, takeProfit: null, stopChanges: 2 }, trade: cleared },
    ]);
    expect(await prisma.transaction.count({ where: { accountId: input.accountId, kind: "TRADE_STAKE" } })).toBe(1);
  }, 30000);

  it("rejects a stop edit when the database closes the trade during the command and replays it on restart", async () => {
    let closeTradeId: string | undefined;
    const r = await runtime(async (stage) => {
      if (stage !== "applied" || !closeTradeId) return;
      const id = closeTradeId;
      closeTradeId = undefined;
      await prisma.trade.update({ where: { id }, data: { status: "REFUNDED" } });
    });
    await freezeRuntimeClock(r);
    const input = await fixture(r, "DEMO");
    const trade = await r.open(input);
    const request = { actorId: input.actorId, requestId: randomUUID(), stopLoss: trade.entryPrice * 0.5, takeProfit: null };
    await r.checkpoint();
    closeTradeId = trade.id;

    const secret = "isolated-runtime-test-secret";
    const http = createOtcHttp(r, secret, 0);
    const port = await http.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/otc/trades/${trade.id}/stops`, {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "trade_not_open" });
    } finally {
      await http.close();
    }
    const saved = await prisma.marketCommand.findFirstOrThrow({ where: { idempotencyKey: `stops:${request.requestId}` } });
    expect(saved).toMatchObject({
      status: "REJECTED",
      result: { error: "trade_not_open", change: { tradeId: trade.id, stopLoss: request.stopLoss, takeProfit: null, stopChanges: 1 } },
    });
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({
      status: "REFUNDED", stopLoss: null, takeProfit: null,
    });
    await expect(r.advance(Date.now() + 1)).resolves.toBeUndefined();
    await r.stop(false);

    const resumed = await runtime();
    await expect(resumed.setStops({ ...request, tradeId: trade.id })).rejects.toThrow("trade_not_open");
    await expect(resumed.advance(trade.expiryTs.getTime())).resolves.toBeUndefined();
  }, 30000);

  it.each(["STOP_LOSS", "TAKE_PROFIT"] as const)("settles an edited %s at the executed price", async (reason) => {
    const r = await runtime();
    await freezeRuntimeClock(r);
    const initial = await r.snapshot("BTCUSDT");
    const input = await fixture(r, "DEMO");
    const displayed = (await r.snapshot(input.symbol)).displayQuote!;
    const state = await (r as unknown as { worker: { checkpoint(): Promise<SimulationCheckpoint> } }).worker.checkpoint();
    const market = MarketWorld.restore(state).markets.get(input.symbol)!;
    let hit: { time: number; price: number } | undefined;
    market.advance(initial.time + 30_000, (fill) => {
      const price = fill.price * market.profile.tickSize;
      if (!hit && Math.abs(price - displayed.price) > market.profile.tickSize / 2) hit = { time: fill.time, price };
    });
    expect(hit).toBeDefined();
    const { time, price } = hit!;
    const up = (price > displayed.price) === (reason === "TAKE_PROFIT");
    // Run the same deterministic market with a demo position, which adds no order-book flow.
    const trade = await r.open({ ...input, quoteToken: displayed.token, direction: up ? "UP" : "DOWN" });
    const level = (displayed.price + price) / 2;
    const request = {
      tradeId: trade.id, actorId: input.actorId, requestId: randomUUID(),
      stopLoss: reason === "STOP_LOSS" ? level : null, takeProfit: reason === "TAKE_PROFIT" ? level : null,
    };
    expect(await r.setStops(request)).toMatchObject({ stopLoss: request.stopLoss, takeProfit: request.takeProfit });
    await r.advance(time);
    expect(await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({
      status: reason === "STOP_LOSS" ? "LOST" : "WON", closeReason: reason, exitPrice: price, closedAt: new Date(time),
      pnl: reason === "STOP_LOSS" ? -10000 : 9200,
    });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: input.accountId } })).realBalance).toBe(
      reason === "STOP_LOSS" ? 90000 : 109200,
    );
  }, 30000);

  it("records business refusals, protects ownership and keeps the change cap after restart", async () => {
    const r = await runtime();
    const clock = await freezeRuntimeClock(r);
    const input = await fixture(r, "DEMO");
    const trade = await r.open(input);
    const request: Omit<OtcStopsRequest, "requestId"> = { tradeId: trade.id, actorId: input.actorId, stopLoss: null, takeProfit: null };
    const edit = (fields: Partial<typeof request> = {}, requestId = randomUUID()) => r.setStops({ ...request, ...fields, requestId });
    await expect(edit({ actorId: randomUUID() })).rejects.toThrow("not_found");
    await expect(edit({ tradeId: randomUUID() })).rejects.toThrow("not_found");
    const legacy = await prisma.trade.create({ data: { ...trade, id: randomUUID(), mode: "LEGACY_BINARY", marketCommandId: null, idempotencyKey: null, status: "CLOSED" } });
    await expect(edit({ tradeId: legacy.id })).rejects.toThrow("not_found");
    const rejectedId = randomUUID();
    await expect(edit({ stopLoss: trade.entryPrice }, rejectedId)).rejects.toThrow("stop_loss_invalid");
    await expect(edit({ stopLoss: trade.entryPrice }, rejectedId)).rejects.toThrow("stop_loss_invalid");
    await expect(edit({ takeProfit: trade.entryPrice })).rejects.toThrow("take_profit_invalid");
    for (let i = 0; i < 20; i++) await edit({ stopLoss: trade.entryPrice * (0.5 + i / 100) });
    await expect(edit()).rejects.toThrow("stops_limit");
    await r.checkpoint();
    await r.stop(false);
    const resumed = await runtime();
    await expect(resumed.setStops({ ...request, requestId: randomUUID() })).rejects.toThrow("stops_limit");
    clock.mockReturnValue(trade.expiryTs.getTime());
    // The database still shows OPEN until the ordered command catches up to expiry.
    await expect(resumed.setStops({ ...request, requestId: randomUUID() })).rejects.toThrow("trade_not_open");
    await expect(resumed.setStops({ ...request, requestId: randomUUID() })).rejects.toThrow("trade_not_open");
    const rejected = await prisma.marketCommand.findMany({ where: { accountId: input.accountId, status: "REJECTED" } });
    expect(rejected.map((row) => row.result)).toEqual(expect.arrayContaining([
      { error: "stop_loss_invalid" }, { error: "take_profit_invalid" }, { error: "stops_limit" }, { error: "trade_not_open" },
    ]));
    expect(rejected).toHaveLength(5);
  }, 30000);
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
