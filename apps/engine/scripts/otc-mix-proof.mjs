import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@asm/db";
import { runCrowd } from "./otc-crowd.mjs";
import { stagingTarget } from "./otc-staging-target.mjs";
const {base,ws,output}=stagingTarget();
if(!process.argv[2])throw new Error("Provide existing normally-registered staging credentials");
const credentials=JSON.parse(await readFile(process.argv[2],"utf8")),sessionCookies=[],ids=[];
try{
  for(const credential of credentials.slice(0,100)){
    const response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(credential)});
    if(response.status!==200)throw new Error(`Normal login failed: HTTP ${response.status}`);
    sessionCookies.push(response.headers.get("set-cookie")?.split(";")[0]);ids.push((await response.json()).userId);
  }
  for(const [mix,arrival] of [["buy-heavy","burst"],["sell-heavy","staggered"]]){
    const report=await runCrowd({base,ws,credentials,sessionCookies,counts:[100],symbolOverride:"BTCUSDT",durationSec:15,loginSpacingMs:0,mix,arrival,onProgress:message=>{if(!message.startsWith("Signed in"))console.log(message);}});
    const scenario=report.scenarios[0];
    await writeFile(resolve(output,`otc-website-${mix}-${arrival}.json`),JSON.stringify(report,null,2));
    if(scenario.totals.accepted+scenario.totals.rejected!==1000||scenario.totals.open!==0||scenario.failures.some(f=>f.status!==409||f.code!=="Liquidity unavailable"))throw new Error("Unexpected crowd/settlement failure");
  }
  const accounting=[];
  for(const [index,userId] of ids.entries()){
    const account=await prisma.account.findUniqueOrThrow({where:{userId_type:{userId,type:"LIVE"}}}),trades=await prisma.trade.findMany({where:{accountId:account.id}});
    const ledger=await prisma.transaction.findMany({where:{accountId:account.id}}),sum=ledger.reduce((n,t)=>n+t.amount,0),pnl=trades.reduce((n,t)=>n+t.pnl,0);
    if(account.currency!=="INR"||account.realBalance!==5_000_000+pnl||sum!==account.realBalance||trades.some(t=>t.status==="OPEN"))throw new Error("Post-combination ledger did not reconcile");
    accounting.push({account:index+1,trades:trades.length,pnl,balance:account.realBalance,ledgerRows:ledger.length});
  }
  await writeFile(resolve(output,"otc-website-mix-accounting.json"),JSON.stringify({recordedAt:new Date().toISOString(),initialPaperBalancePerLiveAccount:5_000_000,accounts:accounting},null,2));
  console.log("Buy-heavy burst and sell-heavy staggered same-market crowds reconciled.");
}finally{await prisma.$disconnect();}
