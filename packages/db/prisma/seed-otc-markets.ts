import { prisma } from "../src/client";
import { OTC_MARKETS } from "../src/otc-catalogue";

/** Explicit asset-only migration step: never creates users or resets balances. */
async function main(){
  if(process.env.OTC_ORDER_BOOK_ENABLED!=="true")throw new Error("Enable OTC_ORDER_BOOK_ENABLED explicitly before seeding OTC markets");
  await prisma.$transaction(async tx=>{
    for(const asset of OTC_MARKETS){await tx.asset.upsert({where:{symbol:asset.symbol},
      create:{...asset,isOpen:true},update:{...asset,isOpen:true}});}
    await tx.asset.updateMany({where:{symbol:{notIn:OTC_MARKETS.map(m=>m.symbol)}},data:{isOpen:false}});
  });
  console.log(`Prepared ${OTC_MARKETS.length} OTC markets at 92% payout. No users or balances changed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
