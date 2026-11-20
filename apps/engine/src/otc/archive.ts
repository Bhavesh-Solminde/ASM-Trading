import { Prisma,assertOtcFence,type DbClient,type DbTransaction,type OtcFence } from "@asm/db";
import { TIMEFRAME_SEC,type CandleDto,type Timeframe } from "@asm/contracts";
import { RETAINED_CANDLES,type Candle,type SimulationCheckpoint } from "@asm/market-sim";

export interface OtcArchiveBatch {
  candles:{symbol:string;time:number;open:number;high:number;low:number;close:number;volume:number}[];
}

/** Append-only, replay-idempotent records. A checkpoint may pass only after this commits. */
export async function persistOtcArchive(client:DbClient,fence:OtcFence,batch:OtcArchiveBatch){
  if(!batch.candles.length)return;
  await client.$transaction(async tx=>{
    await assertOtcFence(tx,fence);
    for(let i=0;i<batch.candles.length;i+=1000)await tx.otcCandle.createMany({skipDuplicates:true,data:batch.candles.slice(i,i+1000).map(b=>({
      worldId:fence.worldId,symbol:b.symbol,openTs:new Date(b.time*1000),o:b.open,h:b.high,l:b.low,c:b.close,volume:b.volume,
    }))});
  },{timeout:30000});
}

/**
 * A compact checkpoint carries only each market's forming bar. Reload the newest closed bars from the
 * archive so the restored world holds the same RETAINED_CANDLES it had in memory. A full (older)
 * checkpoint already holds them, and then nothing is read.
 */
export async function loadClosedCandles(client:DbClient,worldId:string,checkpoint:SimulationCheckpoint):Promise<Record<string,Candle[]>>{
  const entries=await Promise.all(checkpoint.markets.map(async m=>{
    const limit=RETAINED_CANDLES-m.candles.length;
    if(limit<=0)return [m.profile.symbol,[]] as const;
    const before=new Date((m.candles[0]?.time??Math.floor(m.clock/60000)*60)*1000);
    const rows=await client.otcCandle.findMany({where:{worldId,symbol:m.profile.symbol,openTs:{lt:before}},orderBy:{openTs:"desc"},take:limit});
    return [m.profile.symbol,rows.reverse().map(r=>({time:r.openTs.getTime()/1000,open:r.o,high:r.h,low:r.l,close:r.c,volume:r.volume}))] as const;
  }));
  return Object.fromEntries(entries);
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

export interface RetentionOptions {batchSize?:number;lockTimeoutMs?:number;}

/**
 * System WAL is disposable only behind a durable checkpoint. Trade receipts stay for idempotency.
 * Deletes in small transactions so no single one holds locks for long, and gives up on a locked
 * table rather than waiting; the caller retries next hour.
 */
export async function retainOtcHistory(client:DbClient,fence:OtcFence,watermark:bigint,time:number,{batchSize=5000,lockTimeoutMs=5000}:RetentionOptions={}){
  const commandsBefore=new Date(time-86400000),candlesBefore=new Date(time-365*86400000);
  const drain=async(remove:(tx:DbTransaction)=>Promise<number>)=>{
    let total=0;
    for(;;){
      const deleted=await client.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('lock_timeout',${`${Math.max(1,Math.floor(lockTimeoutMs))}ms`},true)`;
        const count=await remove(tx);
        // Fence last: the checkpoint row stays share-locked only until this commit, not while a delete waits.
        await assertOtcFence(tx,fence);
        return count;
      });
      total+=deleted;if(deleted<batchSize)return total;
    }
  };
  const commands=await drain(tx=>tx.$executeRaw`DELETE FROM "MarketCommand" WHERE "id" IN (
    SELECT "id" FROM "MarketCommand" WHERE "worldId"=${fence.worldId} AND "sequence"<=${watermark} AND "accountId" IS NULL
      AND "status"='APPLIED' AND "acceptedAt"<${commandsBefore} LIMIT ${batchSize})`);
  const candles=await drain(tx=>tx.$executeRaw`DELETE FROM "OtcCandle" WHERE ("worldId","symbol","openTs") IN (
    SELECT "worldId","symbol","openTs" FROM "OtcCandle" WHERE "worldId"=${fence.worldId} AND "openTs"<${candlesBefore} LIMIT ${batchSize})`);
  return {commands,candles};
}
