import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@asm/db";
import { stagingTarget } from "./otc-staging-target.mjs";
const {output}=stagingTarget();
const paths=["otc-website-crowd.json","otc-website-crowd-paced.json","otc-website-buy-heavy-burst.json","otc-website-sell-heavy-staggered.json"];
if(process.argv[2])paths.push("otc-website-performance-crowd.json");
try{
  for(const path of paths){
    const target=resolve(output,path),report=JSON.parse(await readFile(target,"utf8"));let checked=0;
    for(const scenario of report.scenarios){
      const rows=await prisma.trade.findMany({where:{id:{in:scenario.trades.map(t=>t.id)}},include:{account:{select:{userId:true}}}}),byId=new Map(rows.map(t=>[t.id,t]));
      for(const trade of scenario.trades){
        const row=byId.get(trade.id);if(!row||row.status!==trade.status||row.entryPrice!==trade.entryPrice||row.pnl!==trade.pnl)throw new Error("Saved report differs from its durable trade");
        const candidates=await prisma.marketExecution.findMany({where:{worldId:"otc-main",symbol:trade.symbol,time:row.entryTs,takerId:`tobs-user:${row.account.userId}`,sequence:{lte:row.entrySequence}},orderBy:{sequence:"desc"},take:240});
        const fills=[];let quantity=0;for(const fill of candidates){if(quantity>=row.filledLots)break;quantity+=fill.quantity;fills.unshift({sequence:fill.sequence.toString(),time:fill.time.toISOString(),price:fill.price,quantity:fill.quantity,side:fill.side});}
        if(quantity!==row.filledLots||!quantity)throw new Error("Entry quantity does not reconcile with the matched execution audit");
        const vwap=fills.reduce((sum,f)=>sum+f.price*f.quantity,0)/quantity;
        if(Math.abs(vwap-row.entryPrice)>Math.max(1e-8,row.entryPrice*1e-12))throw new Error("Entry VWAP does not reconcile with matched orders");
        Object.assign(trade,{currency:row.currency,flowLots:row.flowLots,filledLots:row.filledLots,entrySequence:row.entrySequence?.toString(),settlementSequence:row.settlementSequence?.toString(),
          acceptedEntryTime:row.entryTs.toISOString(),expiryTime:row.expiryTs.toISOString(),settledTime:row.closedAt?.toISOString(),matchedExecutions:fills});checked++;
      }
      // Attach durable closed candles for the exact scenario window, independent
      // of how often the browser-facing samples were delivered.
      const from=new Date(scenario.startedAt),until=new Date(from.getTime()+scenario.elapsedMs+60000);
      const candles=await prisma.otcCandle.findMany({where:{worldId:"otc-main",symbol:{in:[...new Set(scenario.trades.map(t=>t.symbol))]},openTs:{gte:new Date(Math.floor(from.getTime()/60000)*60000),lte:until}},orderBy:[{symbol:"asc"},{openTs:"asc"}]});
      scenario.closedCandles=candles.map(({worldId,...bar})=>bar);
    }
    report.executionAudit={checkedTrades:checked,recordedAt:new Date().toISOString(),source:"Matched MarketExecution rows and durable Trade/OtcCandle records in isolated acceptance database; outcomes were not rerun or altered"};
    await writeFile(target,JSON.stringify(report,null,2));console.log(`${path}: ${checked} entry quantities and VWAPs reconciled`);
  }
  if(process.argv[2]){
    const trades=await prisma.trade.findMany({where:{mode:"OTC_FIXED",account:{type:"LIVE"}},include:{account:{select:{realBalance:true,bonusBalance:true}}}});
    for(const accountId of new Set(trades.map(t=>t.accountId))){
      const rows=trades.filter(t=>t.accountId===accountId),ledger=await prisma.transaction.findMany({where:{accountId}}),balance=rows[0].account.realBalance+rows[0].account.bonusBalance;
      if(rows.some(t=>t.status==="OPEN")||ledger.reduce((sum,t)=>sum+t.amount,0)!==balance||5_000_000+rows.reduce((sum,t)=>sum+t.pnl,0)!==balance)throw new Error("Final staging account balance did not reconcile");
    }
    await writeFile(resolve(output,"otc-final-accounting.json"),JSON.stringify({recordedAt:new Date().toISOString(),checkedTrades:trades.length,checkedAccounts:new Set(trades.map(t=>t.accountId)).size,allSettled:true,ledgerAndPnlReconcile:true},null,2));
  }
}finally{await prisma.$disconnect();}
