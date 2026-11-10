import { readFile,writeFile,mkdir } from "node:fs/promises";
import { dirname,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

const local=host=>["127.0.0.1","localhost","[::1]"].includes(host);
function checkTarget(base,ws){
  if(process.env.OTC_STAGING_RUN!=="true")throw new Error("Set OTC_STAGING_RUN=true for this paper/staging load test");
  const named=process.env.OTC_STAGING_PROJECT==="asmtrader-otc-staging"&&base==="http://web:3000"&&ws==="ws://engine:4001";
  if(!named&&(!local(new URL(base).hostname)||!local(new URL(ws).hostname)))throw new Error("Crowd runner only accepts loopback or the named isolated staging services");
}
async function request(base,path,cookie,body,extraHeaders={}){
  const response=await fetch(new URL(path,base),{method:body===undefined?"GET":"POST",headers:{...extraHeaders,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"error",signal:AbortSignal.timeout(25000)});
  const value=await response.json();return {status:response.status,value,cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
async function connect(base,url,client){
  const ticket=await request(base,"/api/auth/ws-ticket",client.cookie,{});
  if(ticket.status!==200)throw new Error("Unable to obtain chart ticket");
  const socket=new WebSocket(url),capture={bytes:0,messages:0,errors:[],samples:[],generations:new Set(),privateTradeIds:new Set()};
  let authed=false;
  socket.addEventListener("open",()=>socket.send(JSON.stringify({type:"auth",token:ticket.value.ticket})));
  socket.addEventListener("message",event=>{
    const raw=String(event.data);capture.bytes+=Buffer.byteLength(raw);capture.messages++;
    const m=JSON.parse(raw);
    if(m.type==="authed"){
      authed=true;socket.send(JSON.stringify({type:"subscribe",symbol:client.symbol,timeframe:"1m"}));
    }
    if(m.type==="otc:market"){
      capture.generations.add(m.generation);
      const last=m.candles.at(-1);capture.samples.push({receivedAt:Date.now(),marketTime:m.time,symbol:m.symbol,sequence:m.sequence,reset:m.reset,
        price:last?.c??null,candle:last??null,phase:m.phase,activeTobs:m.activeTobs,openTobs:m.openTobs??null,bid:m.depth.bids[0]?.price??null,ask:m.depth.asks[0]?.price??null});
      if(capture.samples.length>240)capture.samples.shift();
    }
    if(m.type==="trade:opened"||m.type==="trade:settled")capture.privateTradeIds.add(m.trade.id);
    if(m.type==="error")capture.errors.push(m.message);
  });
  const end=Date.now()+15000;while(!authed||!capture.samples.length){if(Date.now()>end){socket.close();throw new Error("Chart authentication/snapshot timed out");}await wait(20);}
  return {socket,capture};
}

/** Credentials are read locally, used only for normal login, and never enter reports. */
export async function runCrowd({base,ws,credentials,sessionCookies,symbolOverride,counts=[1,10,20,40,100],durationSec=30,loginSpacingMs=16000,mix="balanced",arrival="burst",roundSpacingMs=0,liquidityRetries=0,onProgress=()=>{}}){
  checkTarget(base,ws);
  if(!counts.length||counts.some(n=>![1,10,20,40,100].includes(n))||credentials.length<Math.max(...counts))throw new Error("Provide enough normally signed-up accounts for every requested cohort");
  if(![5,10,15,30,60].includes(durationSec))throw new Error("Use a short offered staging duration");
  if(!["balanced","buy-heavy","sell-heavy"].includes(mix)||!["burst","staggered"].includes(arrival))throw new Error("Unknown crowd combination");
  const symbols=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","LTCUSDT","LINKUSDT","DOTUSDT",
    "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY",
    "NIFTY50","BANKNIFTY","FINNIFTY","NIFTYIT","NIFTYMIDCAP100","SENSEX","XAUUSD","XAGUSD","WTI","BRENT"];
  if(symbolOverride&&!symbols.includes(symbolOverride))throw new Error("Unknown staging market");
  const clients=[],connections=[],report={startedAt:new Date().toISOString(),model:"OTC_FIXED",accountType:"LIVE",tradesPerAccount:10,durationSec,mix,arrival,roundSpacingMs,liquidityRetries,symbolOverride:symbolOverride??null,scenarios:[]};
  try{
    for(const [index,credential] of credentials.slice(0,Math.max(...counts)).entries()){
      if(index&&loginSpacingMs)await wait(loginSpacingMs);
      const login=sessionCookies?.[index]?{status:200,cookie:sessionCookies[index]}:await request(base,"/api/auth/login",null,{email:credential.email,password:credential.password});
      if(login.status!==200||!login.cookie)throw new Error(`Login failed for account ${index+1} (HTTP ${login.status})`);
      const list=await request(base,"/api/accounts",login.cookie),account=list.value.accounts?.find(a=>a.type==="LIVE");
      if(!account||account.currency!=="INR")throw new Error(`Account ${index+1} requires its own INR LIVE test balance`);
      clients.push({index:index+1,cookie:login.cookie,accountId:account.id,symbol:symbolOverride??symbols[index%symbols.length]});
      onProgress(`Signed in ${index+1} of ${Math.max(...counts)}`);
    }
    for(const client of clients)connections.push(await connect(base,ws,client));
    for(const count of counts){
      const scenario={count,startedAt:new Date().toISOString(),trades:[],failures:[],elapsedMs:0,charts:[]},started=Date.now();
      onProgress(`Starting ${count} accounts × 10 simultaneous rounds`);
      for(let round=0;round<10;round++){
      if(round&&roundSpacingMs)await wait(roundSpacingMs);
      await Promise.all(clients.slice(0,count).map(async client=>{
        if(arrival==="staggered")await wait((client.index%10)*100);
        const direction=mix==="balanced"?((round+client.index)%2?"UP":"DOWN"):(round+client.index)%5===0?(mix==="buy-heavy"?"DOWN":"UP"):(mix==="buy-heavy"?"UP":"DOWN");
        const body={accountId:client.accountId,symbol:client.symbol,direction,stake:10000,durationSec,idempotencyKey:randomUUID()};
        const sentAt=Date.now(),attempts=[];let result;
        for(let liquidityAttempt=0;liquidityAttempt<=liquidityRetries;liquidityAttempt++){
        for(let retry=0;retry<4;retry++){
          const at=Date.now();
          try{result=await request(base,"/api/trades",client.cookie,body);}catch{result={status:503,value:{error:"Request interrupted"}};}
          attempts.push({sentAt:new Date(at).toISOString(),idempotencyKey:body.idempotencyKey,status:result.status,code:result.value.code??null});
          if(result.status!==503)break;await wait(1000*(retry+1));
        }
        if(result.status!==409||result.value.code!=="Liquidity unavailable"||liquidityAttempt===liquidityRetries)break;
        // A known rejection was refunded. A new attempt needs a new key;
        // ambiguous network failures above always keep their original key.
        await wait(6500);body.idempotencyKey=randomUUID();
        }
        const record={account:client.index,round:round+1,sentAt:new Date(sentAt).toISOString(),latencyMs:Date.now()-sentAt,
          symbol:body.symbol,direction:body.direction,stake:body.stake,idempotencyKey:body.idempotencyKey,attempts};
        if(result.status===201)scenario.trades.push({...record,...result.value.trade});
        else scenario.failures.push({...record,status:result.status,error:result.value.error,code:result.value.code});
      }));
      }
      const deadline=Date.now()+durationSec*1000+30000;
      let unsettled=true;
      while(unsettled&&Date.now()<deadline){
        await wait(1000);unsettled=false;
        for(const client of clients.slice(0,count)){
          const history=await request(base,`/api/trades?accountId=${client.accountId}`,client.cookie);
          if(history.status!==200)throw new Error("History unavailable during settlement verification");
          for(const trade of scenario.trades.filter(t=>t.account===client.index)){
            const settled=history.value.trades.find(t=>t.id===trade.id);
            if(settled)Object.assign(trade,settled);if(trade.status==="OPEN")unsettled=true;
          }
        }
      }
      scenario.elapsedMs=Date.now()-started;
      scenario.totals={accepted:scenario.trades.length,rejected:scenario.failures.length,open:scenario.trades.filter(t=>t.status==="OPEN").length,
        stake:scenario.trades.reduce((sum,t)=>sum+t.stake,0),pnl:scenario.trades.reduce((sum,t)=>sum+t.pnl,0)};
      scenario.charts=connections.slice(0,count).map(({capture},i)=>({account:i+1,bytes:capture.bytes,messages:capture.messages,generations:[...capture.generations],errors:capture.errors,
        samples:capture.samples.filter(s=>s.receivedAt>=started),privateTradeIds:[...capture.privateTradeIds]}));
      for(const chart of scenario.charts){
        const ownIds=new Set(scenario.trades.filter(t=>t.account===chart.account).map(t=>t.id));
        // Prior cohorts' own notifications are allowed; another account's never are.
        const foreign=scenario.trades.some(t=>t.account!==chart.account&&chart.privateTradeIds.includes(t.id));
        if(foreign)throw new Error("Private trade notification crossed account boundary");
        chart.receivedOwnTrades=[...ownIds].filter(id=>chart.privateTradeIds.includes(id)).length;
      }
      report.scenarios.push(scenario);onProgress(`Finished ${count}: ${scenario.totals.accepted} accepted, ${scenario.totals.rejected} rejected, ${scenario.totals.open} still open`);
    }
    report.finishedAt=new Date().toISOString();return report;
  }finally{for(const connection of connections)connection.socket.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const manifest=process.argv[2],output=resolve(process.argv[3]??"otc-crowd-report.json");
  if(!manifest)throw new Error("Usage: node otc-crowd.mjs path/to/local.otc-credentials.json [report.json]");
  const credentials=JSON.parse(await readFile(manifest,"utf8"));
  const report=await runCrowd({base:process.env.OTC_STAGING_URL??"http://127.0.0.1:4300",ws:process.env.OTC_STAGING_WS??"ws://127.0.0.1:4401",credentials,
    ...(process.env.OTC_LOGIN_SPACING_MS?{loginSpacingMs:Number(process.env.OTC_LOGIN_SPACING_MS)}:{}),
    ...(process.env.OTC_DURATION_SEC?{durationSec:Number(process.env.OTC_DURATION_SEC)}:{}),
    ...(process.env.OTC_ROUND_SPACING_MS?{roundSpacingMs:Number(process.env.OTC_ROUND_SPACING_MS)}:{}),
    ...(process.env.OTC_MIX?{mix:process.env.OTC_MIX}:{}),...(process.env.OTC_ARRIVAL?{arrival:process.env.OTC_ARRIVAL}:{}),
    ...(process.env.OTC_SYMBOL?{symbolOverride:process.env.OTC_SYMBOL}:{}),onProgress:console.log});
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));console.log(`Saved ${output}`);
}
