import { Prisma,assertOtcFence,type DbClient,type OtcFence } from "@asm/db";
import { TIMEFRAME_SEC,type CandleDto,type Timeframe } from "@asm/contracts";

export interface OtcArchiveBatch {
  candles:{symbol:string;time:number;open:number;high:number;low:number;close:number;volume:number}[];
  executions:{symbol:string;sequence:number;time:number;price:number;quantity:number;side:string;makerId:string;takerId:string}[];
}

/** Append-only, replay-idempotent records. A checkpoint may pass only after this commits. */
export async function persistOtcArchive(client:DbClient,fence:OtcFence,batch:OtcArchiveBatch){
  if(!batch.candles.length&&!batch.executions.length)return;
  await client.$transaction(async tx=>{
    await assertOtcFence(tx,fence);
    for(let i=0;i<batch.candles.length;i+=1000)await tx.otcCandle.createMany({skipDuplicates:true,data:batch.candles.slice(i,i+1000).map(b=>({
      worldId:fence.worldId,symbol:b.symbol,openTs:new Date(b.time*1000),o:b.open,h:b.high,l:b.low,c:b.close,volume:b.volume,
    }))});
    for(let i=0;i<batch.executions.length;i+=1000)await tx.marketExecution.createMany({skipDuplicates:true,data:batch.executions.slice(i,i+1000).map(f=>({
      ...f,worldId:fence.worldId,sequence:BigInt(f.sequence),time:new Date(f.time),
    }))});
  },{timeout:30000});
}

/** Read at most the minute rows needed for one page; do not scan a year per pan. */
export async function readOtcCandles(client:DbClient,worldId:string,symbol:string,timeframe:Timeframe,before:number,limit:number):Promise<CandleDto[]>{
  const width=TIMEFRAME_SEC[timeframe];
  if(!Number.isFinite(before)||!Number.isInteger(limit)||limit<1||limit>500)throw new Error("Invalid history page");
  const end=new Date(Math.floor(before/width)*width*1000),sourceLimit=(limit+1)*(width/60);
  const rows=await client.$queryRaw<{openTs:Date;o:number;h:number;l:number;c:number;volume:number}[]>(Prisma.sql`
    WITH source AS (
      SELECT * FROM "OtcCandle" WHERE "worldId"=${worldId} AND "symbol"=${symbol} AND "openTs"<${end}
      ORDER BY "openTs" DESC LIMIT ${sourceLimit}
    ) SELECT date_bin(make_interval(secs => ${width}::double precision), "openTs", TIMESTAMP '1970-01-01') AS "openTs",
      (array_agg(o ORDER BY "openTs" ASC))[1] AS o, max(h) AS h, min(l) AS l,
      (array_agg(c ORDER BY "openTs" DESC))[1] AS c, sum(volume) AS volume
    FROM source GROUP BY 1 ORDER BY 1 DESC LIMIT ${limit}
  `);
  return rows.reverse().map(b=>({...b,openTs:b.openTs.getTime()/1000}));
}

/** System WAL is disposable only behind a durable checkpoint. Trade receipts stay for idempotency. */
export async function retainOtcHistory(client:DbClient,fence:OtcFence,watermark:bigint,time:number){
  await client.$transaction(async tx=>{
    await assertOtcFence(tx,fence);
    await tx.marketExecution.deleteMany({where:{worldId:fence.worldId,time:{lt:new Date(time-7*86400000)}}});
    await tx.otcCandle.deleteMany({where:{worldId:fence.worldId,openTs:{lt:new Date(time-365*86400000)}}});
    await tx.marketCommand.deleteMany({where:{worldId:fence.worldId,sequence:{lte:watermark},accountId:null,status:"APPLIED",acceptedAt:{lt:new Date(time-86400000)}}});
  },{timeout:30000});
}
