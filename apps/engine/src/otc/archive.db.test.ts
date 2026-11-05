import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma,type OtcFence } from "@asm/db";
import { persistOtcArchive,readOtcCandles,retainOtcHistory,type OtcArchiveBatch } from "./archive";

const enabled=Boolean(process.env.OTC_TEST_DATABASE_URL);
const fence:OtcFence={worldId:`archive-${randomUUID()}`,generation:randomUUID()};
const start=Date.parse("2026-11-05T10:00:00Z"),minute=60000;
function batch(count:number):OtcArchiveBatch{return {
  candles:Array.from({length:count},(_,i)=>({symbol:"BTCUSDT",time:(start+i*minute)/1000,open:100+i,high:102+i,low:99+i,close:101+i,volume:3})),
  executions:[{symbol:"BTCUSDT",sequence:1,time:start,price:101,quantity:3,side:"BUY",makerId:"bot-1",takerId:"tobs-user-private"}],
};}
describe.skipIf(!enabled)("durable closed candles and bounded execution audit",()=>{
  beforeEach(async()=>{
    const url=new URL(process.env.OTC_TEST_DATABASE_URL!);
    if(url.hostname!=="127.0.0.1"||url.pathname!=="/otc_integration"||process.env.DATABASE_URL!==process.env.OTC_TEST_DATABASE_URL)throw new Error("Isolated database required");
    await prisma.marketWorldCheckpoint.create({data:{id:fence.worldId,generation:fence.generation,version:1,sequence:0,state:{}}});
  });
  afterEach(async()=>{
    await prisma.marketCommand.deleteMany({where:{worldId:fence.worldId}});
    await prisma.otcCandle.deleteMany({where:{worldId:fence.worldId}});
    await prisma.marketExecution.deleteMany({where:{worldId:fence.worldId}});
    await prisma.marketWorldCheckpoint.deleteMany({where:{id:fence.worldId}});
  });
  it("replays without duplicate executions and pages beyond the worker buffer",async()=>{
    const input=batch(2000);await persistOtcArchive(prisma,fence,input);await persistOtcArchive(prisma,fence,input);
    expect(await prisma.marketExecution.count({where:{worldId:fence.worldId}})).toBe(1);
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(2000);
    const older=await readOtcCandles(prisma,fence.worldId,"BTCUSDT","1m",start/1000+500*60,200);
    expect(older).toHaveLength(200);expect(older[0]!.o).toBe(400);expect(older.at(-1)!.c).toBe(600);
    const aggregated=await readOtcCandles(prisma,fence.worldId,"BTCUSDT","5m",start/1000+10*60,2);
    expect(aggregated).toEqual([
      {openTs:start/1000,o:100,h:106,l:99,c:105,volume:15},
      {openTs:start/1000+300,o:105,h:111,l:104,c:110,volume:15},
    ]);
  });
  it("rejects stale writers before persisting any audit or candle",async()=>{
    await expect(persistOtcArchive(prisma,{...fence,generation:"old"},batch(1))).rejects.toThrow("fenced");
    expect(await prisma.marketExecution.count({where:{worldId:fence.worldId}})).toBe(0);
  });
  it("compacts only checkpointed system commands and keeps trade receipts",async()=>{
    await persistOtcArchive(prisma,fence,batch(2));
    const old=new Date(start-2*86400000),rows=await Promise.all([
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"APPLIED",input:{},acceptedAt:old}}),
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"APPLIED",input:{},accountId:"receipt",idempotencyKey:randomUUID(),acceptedAt:old}}),
      prisma.marketCommand.create({data:{worldId:fence.worldId,status:"ACCEPTED",input:{},acceptedAt:old}}),
    ]);
    const watermark=rows.reduce((max,r)=>r.sequence>max?r.sequence:max,0n);
    await retainOtcHistory(prisma,fence,watermark,start+8*86400000);
    expect(await prisma.marketCommand.findUnique({where:{id:rows[0]!.id}})).toBeNull();
    expect(await prisma.marketCommand.count({where:{worldId:fence.worldId}})).toBe(2);
    expect(await prisma.marketExecution.count({where:{worldId:fence.worldId}})).toBe(0);
    expect(await prisma.otcCandle.count({where:{worldId:fence.worldId}})).toBe(2);
  });
});
