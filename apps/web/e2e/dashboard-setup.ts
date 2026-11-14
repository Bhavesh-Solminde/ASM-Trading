import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@asm/db";
import { MARKETS } from "../../../packages/db/src/catalogue";
import { MARKET_CALIBRATIONS } from "../../../packages/pricing/src/markets";

export default async function setup() {
  const url=new URL(process.env.DATABASE_URL ?? "http://missing");
  if (!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/asm_dashboard_verify") throw new Error("Dedicated asm_dashboard_verify database required.");
  const now=Math.floor(Date.now()/60000)*60000;
  await prisma.houseTreasury.upsert({where:{id:1},update:{treasuryMinor:100000000,treasuryTargetMinor:100000000},create:{id:1,treasuryMinor:100000000,treasuryTargetMinor:100000000}});
  for(const m of MARKETS){const c=MARKET_CALIBRATIONS.find(c=>c.symbol===m.symbol)!;
    const a=await prisma.asset.upsert({where:{symbol:m.symbol},update:{},create:{...m,isOpen:true,payoutPct:92,spreadBps:1,msmSigma:c.sigma,msmM0:c.m0,intradayProfile:c.profile}});
    await prisma.candle.createMany({skipDuplicates:true,data:Array.from({length:300},(_,i)=>{const o=m.basePrice*(1+Math.sin(i/12)*.001+i*.00001),v=m.basePrice*.0003;return{assetId:a.id,timeframe:"1m",openTs:new Date(now-(300-i)*60000),o,h:o+v,l:o-v,c:o+Math.sin(i)*v*.7};})});
  }
  const user=await prisma.user.upsert({where:{email_role_legacySimulated: { email: "dashboard-verify@test.local", role: "USER", legacySimulated: false }},update:{},create:{email:"dashboard-verify@test.local",passwordHash:"fixture-no-login",nickname:"Dashboard review",country:"IN",emailVerified:true,vpnExempt:true}});
  const account=await prisma.account.upsert({where:{userId_type:{userId:user.id,type:"DEMO"}},update:{realBalance:100000000,bonusBalance:0},create:{userId:user.id,type:"DEMO",currency:"INR",realBalance:100000000}});
  await prisma.trade.deleteMany({where:{accountId:account.id}});
  const gold=await prisma.asset.findUniqueOrThrow({where:{symbol:"XAUUSD"}});
  for(const [i,reason,pnl] of [[0,"TAKE_PROFIT",2270],[1,"STOP_LOSS",-1550],[2,"MANUAL",0]] as const)await prisma.trade.create({data:{accountId:account.id,assetId:gold.id,direction:i===1?"DOWN":"UP",stake:100000,payoutPct:0,leverage:100,durationSec:300,entryPrice:2700,entryTs:new Date(now-(15-i)*60000),expiryTs:new Date(now-(10-i)*60000),closedAt:new Date(now-(12-i)*60000),exitPrice:2700+pnl/100000/100*2700,status:"CLOSED",pnl,closeReason:reason,stopLoss:2690,takeProfit:2710,spreadFee:100}});
  await prisma.trade.create({data:{accountId:account.id,assetId:gold.id,direction:"UP",stake:10000,payoutPct:92,entryPrice:2700,entryTs:new Date(now-120000),expiryTs:new Date(now-60000),exitPrice:2701,status:"WON",pnl:9200}});
  const token=randomBytes(32).toString("base64url");
  await prisma.session.create({data:{userId:user.id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+86400000)}});
  mkdirSync("e2e/.auth",{recursive:true});
  writeFileSync("e2e/.auth/dashboard-verification.json",JSON.stringify({cookies:[{name:"asm_session",value:token,domain:"localhost",path:"/",expires:Date.now()/1000+86400,httpOnly:true,secure:false,sameSite:"Lax"}],origins:[{origin:"http://localhost:3000",localStorage:[{name:"asm_chart_symbol",value:"XAUUSD"}]}]}));
  await prisma.$disconnect();
}
