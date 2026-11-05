import type { ReferenceQuote,ReferenceRepository } from "@asm/market-sim";
import { prisma,type DbClient } from "../client";

/** Last-good quote and audit entry commit together; no broker calls in a DB transaction. */
export function marketReferenceRepository(client:DbClient=prisma):ReferenceRepository {
  return {
    async loadSchedule(){return (await client.marketReferencePoll.findMany()).map(row=>({...row,attemptedAt:row.attemptedAt.getTime(),nextDueAt:row.nextDueAt.getTime()}));},
    async saveSchedule(schedule){const data={...schedule,attemptedAt:new Date(schedule.attemptedAt),nextDueAt:new Date(schedule.nextDueAt)};
      await client.marketReferencePoll.upsert({where:{group:schedule.group},create:data,update:data});},
    async load(){
      const rows=await client.marketReference.findMany();
      return rows.map(row=>{
        if(!["PUBLIC_QUOTE","PUBLIC_DELAYED","FUTURES_PROXY","ILLUSTRATIVE"].includes(row.kind)
          ||!["OPEN","CLOSED","UNKNOWN"].includes(row.session))throw new Error(`Invalid stored reference metadata: ${row.symbol}`);
        return {symbol:row.symbol,price:row.price,quoteTime:row.quoteTime.getTime(),receivedAt:row.receivedAt.getTime(),
          source:row.source,url:row.sourceUrl,kind:row.kind as ReferenceQuote["kind"],minuteBps:row.minuteBps,
          calibration:row.calibration,sampleBars:row.sampleBars,session:row.session as ReferenceQuote["session"]};
      });
    },
    async save(quote){
      await client.$transaction(async tx=>{
        // Also protects the stale-write boundary if a replacement engine overlaps shutdown.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`reference:${quote.symbol}`}))::text`;
        const prior=await tx.marketReference.findUnique({where:{symbol:quote.symbol}});
        if(prior&&prior.quoteTime.getTime()>quote.quoteTime)throw new Error("Stored reference is newer than incoming quote");
        const data={symbol:quote.symbol,price:quote.price,quoteTime:new Date(quote.quoteTime),receivedAt:new Date(quote.receivedAt),
          source:quote.source,sourceUrl:quote.url,kind:quote.kind,minuteBps:quote.minuteBps,
          calibration:quote.calibration,sampleBars:quote.sampleBars,session:quote.session};
        await tx.marketReference.upsert({where:{symbol:quote.symbol},create:data,update:data});
        if(!prior||prior.price!==quote.price||prior.quoteTime.getTime()!==quote.quoteTime){
          await tx.marketReferenceAudit.create({data:{symbol:quote.symbol,quoteTime:data.quoteTime,receivedAt:data.receivedAt,payload:{...quote}}});
        }
        await tx.marketReferenceAudit.deleteMany({where:{symbol:quote.symbol,receivedAt:{lt:new Date(quote.receivedAt-30*86400000)}}});
      });
    },
  };
}
