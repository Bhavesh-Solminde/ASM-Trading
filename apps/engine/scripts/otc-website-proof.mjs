import { mkdir,writeFile,readFile } from "node:fs/promises";
import { randomUUID,randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { prisma } from "@asm/db";
import { runCrowd } from "./otc-crowd.mjs";
import { stagingTarget } from "./otc-staging-target.mjs";

// Deliberately narrower than the reusable runner: this fixture may fund only a
// disposable DB, and never inserts a User or a Session directly.
const {base,ws,output,metrics:metricsUrl,credentials:credentialDir,scope}=stagingTarget();
const run=randomUUID(),fund=5_000_000,credentials=[],created=[];
const existing=process.argv[2]?JSON.parse(await readFile(process.argv[2],"utf8")):null;
const measurements=[],measurementErrors=[];let measuring=false;
async function measure(){
  if(measuring)return;measuring=true;
  try{
    const at=performance.now();await prisma.$queryRaw`SELECT 1`;
    const databaseProbeMs=performance.now()-at,begin=performance.now();
    const response=await fetch(metricsUrl,{headers:{Authorization:`Bearer ${process.env.ENGINE_INTERNAL_SECRET}`},signal:AbortSignal.timeout(5000)});
    if(response.status!==200)throw new Error(`Metrics HTTP ${response.status}`);
    const metrics=await response.json();measurements.push({time:new Date().toISOString(),databaseProbeMs,metricsHttpMs:performance.now()-begin,
      process:metrics.process?.samples?.at(-1)??null,transport:metrics.transport??null});
  }finally{measuring=false;}
}
const measurementTimer=setInterval(()=>void measure().catch(error=>measurementErrors.push({time:new Date().toISOString(),error:String(error)})),5000);
async function api(path,body,cookie,headers={}){
  const response=await fetch(new URL(path,base),{method:body===undefined?"GET":"POST",headers:{...headers,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  return {status:response.status,value:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
function assert(value,message){if(!value)throw new Error(message);}
try{
  await mkdir(output,{recursive:true});
  for(let i=0;i<100;i++){
    const email=existing?.[i]?.email??`otc-proof-${run}-${i}@example.test`,password=existing?.[i]?.password??randomBytes(24).toString("base64url");
    const registered=existing?await api("/api/auth/login",{email,password}):await api("/api/auth/register",{name:`Local Paper ${i+1}`,email,password},null,{"x-real-ip":`198.18.0.${i+1}`});
    assert(registered.status===(existing?200:201),`Normal authentication ${i+1} failed: HTTP ${registered.status}`);
    const user=await prisma.user.findUniqueOrThrow({where:{id:registered.value.userId},select:{id:true,role:true,accounts:true}});
    assert(user.role==="USER","Normal signup role must be USER");assert(user.accounts.length===2,"Normal signup must provide LIVE and DEMO");
    const live=user.accounts.find(a=>a.type==="LIVE"),demo=user.accounts.find(a=>a.type==="DEMO");
    assert(live&&demo&&(existing||live.realBalance===0),"New LIVE account must start unfunded");
    if(!existing)await prisma.$transaction(async tx=>{
      await tx.account.update({where:{id:live.id},data:{realBalance:fund,version:{increment:1}}});
      await tx.transaction.create({data:{accountId:live.id,kind:"DEPOSIT",amount:fund,balanceAfter:fund,refType:"ISOLATED_PAPER_FIXTURE",refId:run}});
      await tx.auditLog.create({data:{action:"STAGING_PAPER_BALANCE",targetType:"Account",targetId:live.id,after:{run,amount:fund,notRealMoney:true}}});
    });
    credentials.push({email,password});created.push({userId:user.id,liveId:live.id,demoId:demo.id,cookie:registered.cookie});
    if((i+1)%10===0)console.log(`Normal signup verified: ${i+1}/100`);
  }
  await mkdir(credentialDir,{recursive:true});
  await writeFile(resolve(credentialDir,`${run}.otc-credentials.json`),JSON.stringify(credentials),{mode:0o600});
  const first=created[0],second=created[1],symbol="BTCUSDT";
  const paper=await api("/api/trades",{symbol,direction:"UP",stake:10000,durationSec:5,accountId:first.demoId,idempotencyKey:randomUUID()},first.cookie);
  assert(paper.status===201,"DEMO paper open failed");
  const paperRow=await prisma.trade.findUniqueOrThrow({where:{id:paper.value.trade.id}});
  assert(paperRow.flowLots===0&&paperRow.filledLots===0,"DEMO submitted market flow");
  const foreign=await api("/api/trades",{symbol,direction:"UP",stake:10000,durationSec:5,accountId:second.liveId,idempotencyKey:randomUUID()},first.cookie);
  assert(foreign.status===404,"Account ownership was not enforced");
  const forged=await api("/api/trades",{symbol,direction:"UP",stake:10000,durationSec:5,accountId:first.liveId,idempotencyKey:randomUUID(),role:"ADMIN"},first.cookie);
  assert(forged.status===400,"Client role spoofing was not rejected");
  const manual=await api(`/api/cfd/trades/${paperRow.id}/close`,{},first.cookie);
  assert(manual.status===409,"Manual OTC close was not rejected");
  await wait(7000);
  const paperSettled=await prisma.trade.findUniqueOrThrow({where:{id:paperRow.id}});assert(paperSettled.status!=="OPEN","DEMO expiry did not settle");
  const ticket=await api("/api/auth/ws-ticket",{},first.cookie),socket=new WebSocket(ws);
  let latest=null;socket.addEventListener("open",()=>socket.send(JSON.stringify({type:"auth",token:ticket.value.ticket})));
  socket.addEventListener("message",event=>{const message=JSON.parse(String(event.data));if(message.type==="authed")socket.send(JSON.stringify({type:"subscribe",symbol,timeframe:"1m"}));if(message.type==="otc:market")latest=message;});
  const protection=[];
  try{
    const deadline=Date.now()+15000;while(!latest){assert(Date.now()<deadline,"Protection chart snapshot timed out");await wait(20);}
    for(const direction of ["UP","DOWN"]){
      let opened=null;
      for(let attempt=0;attempt<3&&!opened;attempt++){
        const price=latest.candles.at(-1).c,up=direction==="UP",step=.01;
        const response=await api("/api/trades",{symbol,direction,stake:10000,durationSec:60,accountId:first.demoId,idempotencyKey:randomUUID(),
          stopLoss:price+(up?-step:step),takeProfit:price+(up?step:-step)},first.cookie);
        if(response.status===201)opened=response.value.trade;else{assert(response.status===409,"Unexpected protection rejection");await wait(1100);}
      }
      assert(opened,"Unable to open protected paper trade");protection.push(opened);
    }
    const settledBy=Date.now()+75000;
    while(protection.some(t=>t.status==="OPEN")&&Date.now()<settledBy){
      await wait(1000);for(const trade of protection)Object.assign(trade,await prisma.trade.findUniqueOrThrow({where:{id:trade.id}}));
    }
    assert(protection.some(t=>t.closeReason==="STOP_LOSS")&&protection.some(t=>t.closeReason==="TAKE_PROFIT"),"Execution-driven website SL/TP did not settle");
    for(const trade of protection)assert(trade.pnl===(trade.status==="WON"?9200:-10000),"SL/TP fixed payout mismatch");
  }finally{socket.close();}
  const originalCurrency=await api("/api/trades",{symbol,direction:"UP",stake:10000,durationSec:15,accountId:first.demoId,idempotencyKey:randomUUID()},first.cookie);
  assert(originalCurrency.status===201,"Currency lifecycle open failed");
  const changed=await api("/api/account/currency",{accountId:first.demoId,currency:"USD"},first.cookie);assert(changed.status===200,"Normal currency change failed");
  const afterConvert=(await api("/api/accounts",undefined,first.cookie)).value.accounts.find(a=>a.id===first.demoId);
  let currencyTrade=null;const currencyDeadline=Date.now()+30000;
  while(!currencyTrade||currencyTrade.status==="OPEN"){
    assert(Date.now()<currencyDeadline,"Converted-account settlement timed out");await wait(1000);
    currencyTrade=await prisma.trade.findUniqueOrThrow({where:{id:originalCurrency.value.trade.id}});
  }
  const credit=currencyTrade.status==="WON"?192:currencyTrade.status==="REFUNDED"?100:0;
  const currencyAccount=(await api("/api/accounts",undefined,first.cookie)).value.accounts.find(a=>a.id===first.demoId);
  assert(currencyTrade.currency==="INR"&&currencyTrade.stake===10000,"Currency conversion rewrote the fixed contract");
  assert(currencyAccount.currency==="USD"&&currencyAccount.realBalance===afterConvert.realBalance+credit,"Payout was not credited in the account's current currency");
  assert((await api("/api/account/currency",{accountId:first.demoId,currency:"INR"},first.cookie)).status===200,"Currency restore failed");
  const lifecycle={run,normalSignups:created.length,registeredThisRun:existing?0:created.length,role:"USER",paper:{id:paperRow.id,flowLots:paperRow.flowLots,filledLots:paperRow.filledLots,status:paperSettled.status},
    protection:protection.map(t=>({id:t.id,direction:t.direction,entryPrice:t.entryPrice,exitPrice:t.exitPrice,closeReason:t.closeReason,status:t.status,pnl:t.pnl})),
    currencyChange:{tradeCurrency:currencyTrade.currency,stake:currencyTrade.stake,status:currencyTrade.status,pnl:currencyTrade.pnl,creditedCurrency:"USD",creditedMinor:credit,accountBalance:currencyAccount.realBalance},
    foreignAccountStatus:foreign.status,forgedRoleStatus:forged.status,manualCloseStatus:manual.status};
  await writeFile(resolve(output,"otc-website-lifecycle.json"),JSON.stringify(lifecycle,null,2));
  const sessionCookies=created.map(c=>c.cookie);
  const report=await runCrowd({base,ws,credentials,sessionCookies,loginSpacingMs:0,durationSec:15,onProgress:console.log});
  await writeFile(resolve(output,"otc-website-crowd.json"),JSON.stringify(report,null,2));
  for(const scenario of report.scenarios){
    assert(scenario.totals.accepted+scenario.totals.rejected===scenario.count*10,"Crowd did not record every scheduled request");
    assert(scenario.failures.every(f=>f.status===409&&f.code==="Liquidity unavailable"),"Unexpected crowd rejection");
    assert(scenario.totals.open===0,"Crowd settlement incomplete");
  }
  const paced=await runCrowd({base,ws,credentials,sessionCookies,counts:[100],loginSpacingMs:0,durationSec:30,roundSpacingMs:6500,liquidityRetries:3,onProgress:console.log});
  await writeFile(resolve(output,"otc-website-crowd-paced.json"),JSON.stringify(paced,null,2));
  assert(paced.scenarios[0].totals.accepted===1000&&paced.scenarios[0].totals.open===0,"Paced 100-account crowd did not complete every trade");
  const balances=[];
  for(const [index,account] of created.entries()){
    const live=await prisma.account.findUniqueOrThrow({where:{id:account.liveId}}),trades=await prisma.trade.findMany({where:{accountId:account.liveId}});
    assert(live.realBalance===fund+trades.reduce((n,t)=>n+t.pnl,0),`Balance mismatch account ${index+1}`);
    assert(trades.every(t=>t.mode==="OTC_FIXED"&&t.payoutPct===92&&t.flowLots>0&&t.filledLots>0&&t.status!=="OPEN"),"LIVE eligibility, fills or settlement mismatch");
    const ledger=await prisma.transaction.findMany({where:{accountId:account.liveId}});
    assert(ledger.reduce((n,t)=>n+t.amount,0)===live.realBalance,"Ledger sum does not equal balance");
    balances.push({account:index+1,trades:trades.length,pnl:trades.reduce((n,t)=>n+t.pnl,0),balance:live.realBalance,ledgerRows:ledger.length});
  }
  await writeFile(resolve(output,"otc-website-accounting.json"),JSON.stringify({run,initialPaperBalancePerLiveAccount:fund,accounts:balances},null,2));
  assert(measurements.length>0&&measurementErrors.length===0,"Performance collection failed; see saved measurement errors");
  console.log("Normal signup/login, DEMO isolation, LIVE crowd, private notifications and ledger reconciliation passed.");
}finally{
  clearInterval(measurementTimer);while(measuring)await wait(20);
  await mkdir(output,{recursive:true});await writeFile(resolve(output,"otc-website-server-performance.json"),JSON.stringify({scope,measurements,measurementErrors},null,2));
  await prisma.$disconnect();
}
