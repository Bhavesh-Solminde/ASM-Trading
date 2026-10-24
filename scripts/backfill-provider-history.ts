/** Provider-only 14-day 1m backfill. Default: fetch/validate to a local plan;
 * --apply: replace candles in that plan's window. Back up Candle first and
 * stop engine writes during apply. Never synthesizes missing market hours.
 * Run with pnpm --filter @asm/db exec tsx ../../scripts/backfill-provider-history.ts.
 * Live-Rates daily-only history is deliberately not expanded into 1m bars.
 */
import { prisma } from '../packages/db/src/client';
import { writeFileSync, readFileSync } from 'node:fs';
const path=process.env.BACKFILL_PLAN_PATH ?? '/tmp/asm-provider-history.json';
const apply=process.argv.includes('--apply');
const crypto=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'];
const indices:Record<string,string>={NIFTY50:'NSE:NIFTY50-INDEX',BANKNIFTY:'NSE:NIFTYBANK-INDEX',FINNIFTY:'NSE:FINNIFTY-INDEX',NIFTYIT:'NSE:NIFTYIT-INDEX',SENSEX:'BSE:SENSEX-INDEX',NIFTYMIDCAP100:'NSE:NIFTYMIDCAP100-INDEX'};
async function main(){
 if(apply){
  const plan=JSON.parse(readFileSync(path,'utf8'));
  for(const item of plan.assets){
   await prisma.$transaction(async tx=>{
    await tx.candle.deleteMany({where:{assetId:item.id,timeframe:'1m',openTs:{gte:new Date(plan.from),lt:new Date(plan.until)}}});
    for(let i=0;i<item.rows.length;i+=1000) await tx.candle.createMany({data:item.rows.slice(i,i+1000).map((r:number[])=>({assetId:item.id,timeframe:'1m',openTs:new Date(r[0]*1000),o:r[1],h:r[2],l:r[3],c:r[4]})),skipDuplicates:true});
   },{timeout:120000});
   console.log(JSON.stringify({symbol:item.symbol,written:item.rows.length,last:new Date(item.rows.at(-1)[0]*1000).toISOString()}));
  }return;
 }
 const until=Math.floor(Date.now()/60000)*60000,from=until-14*86400000;
 const plan={from,until,assets:[] as any[]};
 const token=await prisma.integrationToken.findUnique({where:{provider:'fyers'}});
 const assets=await prisma.asset.findMany({where:{symbol:{in:[...crypto,...Object.keys(indices)]}}});
 for(const a of assets){
  let rows:number[][]=[];
  if(crypto.includes(a.symbol)){
   let cursor=from;
   while(cursor<until){
    const res=await fetch(`https://api.binance.com/api/v3/klines?symbol=${a.symbol}&interval=1m&startTime=${cursor}&endTime=${until-1}&limit=1000`,{signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error(`${a.symbol} HTTP ${res.status}`);
    const raw=await res.json() as any[];if(!raw.length)break;
    rows.push(...raw.map(r=>[Number(r[0])/1000,...r.slice(1,5).map(Number)]));cursor=Number(raw.at(-1)[0])+60000;
    await new Promise(r=>setTimeout(r,125));
   }
  }else if(token){
   const url=new URL('https://api-t1.fyers.in/data/history');
   for(const [k,v] of Object.entries({symbol:indices[a.symbol],resolution:'1',date_format:'0',range_from:String(from/1000),range_to:String(until/1000-1),cont_flag:'1'}))url.searchParams.set(k,v);
   const res=await fetch(url,{headers:{Authorization:`${process.env.FYERS_APP_ID}:${token.accessToken}`},signal:AbortSignal.timeout(20000)});
   const data=await res.json() as any;
   if(data.s==='ok') rows=data.candles.map((r:any[])=>r.slice(0,5).map(Number));
   else console.log(JSON.stringify({symbol:a.symbol,errorCode:data.code,status:res.status}));
  }
  await new Promise(r=>setTimeout(r,1000));
  rows=rows.filter(r=>r[0]*1000>=from&&r[0]*1000<until).sort((a,b)=>a[0]-b[0]);
  if(!rows.length){console.log(a.symbol+' NO PROVIDER HISTORY');continue;}
  if(rows.some(r=>r.length!==5||r.some(n=>!Number.isFinite(n)||n<=0)||r[2]<Math.max(r[1],r[4])||r[3]>Math.min(r[1],r[4])))throw new Error('Invalid OHLC '+a.symbol);
  plan.assets.push({id:a.id,symbol:a.symbol,rows});
  console.log(JSON.stringify({symbol:a.symbol,bars:rows.length,first:new Date(rows[0][0]*1000).toISOString(),last:new Date(rows.at(-1)![0]*1000).toISOString(),close:rows.at(-1)![4]}));
 }
 writeFileSync(path,JSON.stringify(plan),{mode:0o600});
}
main().catch(()=>{console.error('Backfill failed; no secrets printed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
