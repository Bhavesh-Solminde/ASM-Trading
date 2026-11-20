import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma,type OtcFence } from "@asm/db";
import { persistOtcArchive,readOtcCandles,retainOtcHistory,type OtcArchiveBatch } from "./archive";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL);
const fence:OtcFence={worldId:`archive-${randomUUID()}`,generation:randomUUID()};
const start=Date.parse("2026-11-05T10:00:00Z"),minute=60000,day=86400000;
function batch(count:number,from=start):OtcArchiveBatch{return {
  candles:Array.from({length:count},(_,i)=>({symbol:"BTCUSDT",time:(from+i*minute)/1000,open:100+i,high:102+i,low:99+i,close:101+i,volume:3})),
};}
function systemCommands(count:number,acceptedAt:Date){
  return Promise.all(Array.from({length:count},()=>prisma.marketCommand.create({data:{worldId:fence.worldId,status:"APPLIED",input:{},acceptedAt}})));
}
describe.skipIf(!enabled)("durable closed candles and bounded history retention",()=>{
  beforeEach(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(url.hostname!=="127.0.0.1"||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Isolated database required");
    await prisma.marketWorldCheckpoint.create({data:{id:fence.worldId,generation:fence.generation,version:1,sequence:0,state:{}}});
  });
  afterEach(async()=>{
    await prisma.marketCommand.deleteMany({where:{worldId:fence.worldId}});
    await prisma.otcCandle.deleteMany({where:{worldId:fence.worldId}});
    await prisma.marketWorldCheckpoint.deleteMany({where:{id:fence.worldId}});
  });
  it("replays without duplicate candles and pages beyond the worker buffer",async()=>{
    const input=batch(2000);await persistOtcArchive(prisma,fence,input);await persistOtcArchive(prisma,fence,input);
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(2000);
    const older=await readOtcCandles(prisma,fence.worldId,"BTCUSDT","1m",start/1000+500*60,200);
    expect(older).toHaveLength(200);expect(older[0]!.o).toBe(400);expect(older.at(-1)!.c).toBe(600);
    const aggregated=await readOtcCandles(prisma,fence.worldId,"BTCUSDT","5m",start/1000+10*60,2);
    expect(aggregated).toEqual([
      {openTs:start/1000,o:100,h:106,l:99,c:105,volume:15},
      {openTs:start/1000+300,o:105,h:111,l:104,c:110,volume:15},
    ]);
  });
  it("rejects stale writers before persisting any candle",async()=>{
    await expect(persistOtcArchive(prisma,{...fence,generation:"old"},batch(1))).rejects.toThrow("fenced");
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(0);
  });
  it("compacts only checkpointed system commands and keeps trade receipts",async()=>{
    await persistOtcArchive(prisma,fence,batch(2));
    const old=new Date(start-2*day),rows=await Promise.all([
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"APPLIED",input:{},acceptedAt:old}}),
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"APPLIED",input:{},accountId:"receipt",idempotencyKey:randomUUID(),acceptedAt:old}}),
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"ACCEPTED",input:{},acceptedAt:old}}),
    ]);
    const watermark=rows.reduce((max,r)=>r.sequence>max?r.sequence:max,0n);
    expect(await retainOtcHistory(prisma,fence,watermark,start+8*day)).toEqual({commands:1,candles:0});
    expect(await prisma.marketCommand.findUnique({where:{id:rows[0]!.id}})).toBeNull();
    expect(await prisma.marketCommand.count({where:{worldId:fence.worldId}})).toBe(2);
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(2);
  });
  it("works through a large backlog in bounded batches",async()=>{
    const now=start+400*day;
    // 7 commands is not a multiple of the batch; 6 old candles is, so the loop must stop on an empty batch too.
    const rows=await systemCommands(7,new Date(now-2*day));
    await persistOtcArchive(prisma,fence,batch(6,now-366*day));await persistOtcArchive(prisma,fence,batch(2,now-minute*5));
    const watermark=rows.reduce((max,r)=>r.sequence>max?r.sequence:max,0n);
    expect(await retainOtcHistory(prisma,fence,watermark,now,{batchSize:3})).toEqual({commands:7,candles:6});
    expect(await prisma.marketCommand.count({where:{worldId:fence.worldId}})).toBe(0);
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(2);
  });
  it("gives up quickly instead of waiting on a locked table",async()=>{
    const rows=await systemCommands(2,new Date(start-2*day));
    const watermark=rows.reduce((max,r)=>r.sequence>max?r.sequence:max,0n);
    const blocker=new pg.Client({connectionString:process.env.OTC_TEST_DATABASE_URL});await blocker.connect();
    try{
      await blocker.query("BEGIN");await blocker.query('LOCK TABLE "MarketCommand" IN ACCESS EXCLUSIVE MODE');
      const began=Date.now();
      await expect(retainOtcHistory(prisma,fence,watermark,start+8*day,{lockTimeoutMs:200})).rejects.toThrow();
      expect(Date.now()-began).toBeLessThan(3000);
    }finally{await blocker.query("ROLLBACK");await blocker.end();}
    expect(await prisma.marketCommand.count({where:{worldId:fence.worldId}})).toBe(2);
  });
  it("refuses to delete for a stale writer",async()=>{
    const rows=await systemCommands(1,new Date(start-2*day));
    await expect(retainOtcHistory(prisma,{...fence,generation:"old"},rows[0]!.sequence,start+8*day)).rejects.toThrow("fenced");
    expect(await prisma.marketCommand.count({where:{worldId:fence.worldId}})).toBe(1);
  });
});
