import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@asm/db";
import { stagingTarget } from "./otc-staging-target.mjs";
const {output}=stagingTarget();
try{
  const [references,schedule,assets,roles,accounts,checkpoint,commands,executions,candles]=await Promise.all([
    prisma.marketReference.findMany({orderBy:{symbol:"asc"}}),prisma.marketReferencePoll.findMany({orderBy:{group:"asc"}}),
    prisma.asset.findMany({where:{isOpen:true},select:{symbol:true,payoutPct:true,kind:true},orderBy:{symbol:"asc"}}),
    prisma.user.groupBy({by:["role"],_count:true}),prisma.account.groupBy({by:["type"],_count:true}),
    prisma.marketWorldCheckpoint.findUnique({where:{id:"otc-main"},select:{generation:true,sequence:true,updatedAt:true}}),
    prisma.marketCommand.count({where:{worldId:"otc-main"}}),prisma.marketExecution.count({where:{worldId:"otc-main"}}),prisma.otcCandle.count({where:{worldId:"otc-main"}}),
  ]);
  const report={recordedAt:new Date().toISOString(),scope:"Named disposable acceptance database, no user credentials",references,schedule,assets,roles,accounts,checkpoint,commands,executions,candles};
  await mkdir(output,{recursive:true});await writeFile(resolve(output,"otc-staging-snapshot.json"),JSON.stringify(report,(_,value)=>typeof value==="bigint"?value.toString():value,2));
  if(assets.length!==30||assets.some(a=>a.payoutPct!==92))throw new Error("Staging catalogue differs from 30 markets at 92%");
  if(references.length!==30)throw new Error(`Only ${references.length}/30 external references available; see saved snapshot and provider diagnostics`);
  if(!checkpoint||!executions||!candles)throw new Error("Durable market state is missing");
  console.log(`Verified ${assets.length} markets, ${references.length} references, ${executions} executions and ${candles} closed candles`);
}finally{await prisma.$disconnect();}
