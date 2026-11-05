import { randomInt } from "node:crypto";
import { MULTI_MARKETS,indiaOpen,type MarketSpec,type ReferenceQuote } from "./catalogue";

export interface ReferenceRepository {
  load():Promise<ReferenceQuote[]>;
  save(quote:ReferenceQuote):Promise<void>;
  loadSchedule?():Promise<ReferenceSchedule[]>;
  saveSchedule?(schedule:ReferenceSchedule):Promise<void>;
}
export interface ReferenceSchedule {group:string;nextDueAt:number;attemptedAt:number;failures:number;}
export type ReferenceTransport=(url:string)=>Promise<unknown>;

/** Public snapshots are infrequent reference inputs, never trade executions. */
export async function fetchReferenceJson(url:string):Promise<unknown>{
  const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:"application/json","User-Agent":"ASM-OTC-Reference/1.0"}});
  if(!response.ok)throw new Error(`Reference provider HTTP ${response.status}`);
  if(!response.body)throw new Error("Empty reference response");
  const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>2*1024*1024)throw new Error("Reference response too large");chunks.push(value);}
  }finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const groups=["crypto","rates","indices","futures"] as const;
type Group=typeof groups[number];
// Live-Rates keyless /rates permits three requests/hour/IP.
const interval:Record<Group,number>={crypto:60000,rates:1200000,indices:900000,futures:300000};

export class ReferencePoller {
  private quotes=new Map<string,ReferenceQuote>();
  private due=new Map<Group,number>();
  private failures=new Map<Group,number>();
  private busy=false;
  readonly errors=new Map<string,string>();
  constructor(private repository:ReferenceRepository,private transport:ReferenceTransport=fetchReferenceJson,
    private now:()=>number=Date.now,private jitter:()=>number=()=>randomInt(0,3000),private options:{keylessRates?:boolean}={}){}
  async initialize(){
    for(const quote of await this.repository.load())if(this.valid(quote))this.quotes.set(quote.symbol,{...quote});
    for(const schedule of await this.repository.loadSchedule?.()??[]){
      if(schedule.group==="calibration")continue; // Service-owned hourly history pull.
      if(!groups.includes(schedule.group as Group)||!Number.isSafeInteger(schedule.nextDueAt)||!Number.isSafeInteger(schedule.failures)||schedule.failures<0)throw new Error("Invalid stored reference schedule");
      this.due.set(schedule.group as Group,schedule.nextDueAt);this.failures.set(schedule.group as Group,schedule.failures);
    }
    // Upgrade an existing last-good cache without creating a restart burst.
    for(const group of groups)if(!this.due.has(group)){
      const receipts=this.members(group).map(s=>this.quotes.get(s.symbol)?.receivedAt??0);
      if(receipts.every(Boolean))this.due.set(group,Math.max(...receipts)+interval[group]+this.jitter());
    }
  }
  get(symbol:string){const q=this.quotes.get(symbol);return q?{...q}:null;}
  all(){return [...this.quotes.values()].map(q=>({...q}));}
  async calibrate(){
    const queue=MULTI_MARKETS.filter(s=>(this.get(s.symbol)?.sampleBars??0)<50&&this.get(s.symbol));
    await Promise.all(Array.from({length:4},async()=>{
      while(queue.length){const spec=queue.shift();if(!spec)break;
        try{
          const url=spec.group==="Crypto"?`https://data-api.binance.vision/api/v3/klines?symbol=${spec.symbol}&interval=5m&limit=1000`
            :`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahoo)}?interval=5m&range=1mo`;
          const raw=await this.transport(url);const points:{time:number;price:number}[]=[];
          if(spec.group==="Crypto"){
            for(const bar of array(raw)){const row=array(bar),time=Number(row[0]),price=Number(row[4]);
              if(time+300000<=this.now()&&price>0)points.push({time,price});}
          }else{
            const result=object(array(object(object(raw).chart).result)[0]),times=array(result.timestamp),prices=array(object(array(object(result.indicators).quote)[0]).close);
            for(let i=0;i<times.length;i++){const time=Number(times[i])*1000,price=Number(prices[i]);if(time+300000<=this.now()&&price>0)points.push({time,price});}
          }
          const returns=points.slice(1).flatMap((p,i)=>p.time-points[i]!.time===300000?[Math.log(p.price/points[i]!.price)]:[]).filter(Number.isFinite);
          if(returns.length<50)continue;
          const mean=returns.reduce((n,r)=>n+r,0)/returns.length,variance=returns.reduce((n,r)=>n+(r-mean)**2,0)/returns.length;
          const prior=this.get(spec.symbol);if(!prior)continue;
          await this.accept({...prior,minuteBps:Math.max(.2,Math.min(50,Math.sqrt(variance/5)*10000)),sampleBars:returns.length+1,
            calibration:`Measured completed 5-minute log returns; ${["XAUUSD","XAGUSD"].includes(spec.symbol)?"futures movement proxy; ":""}${url}`});
        }catch{/* Keep the last calibration and reference if historical data is unavailable. */}
      }
    }));
  }
  private valid(q:ReferenceQuote){return MULTI_MARKETS.some(m=>m.symbol===q.symbol)&&Number.isFinite(q.price)&&q.price>0
    &&Number.isSafeInteger(q.quoteTime)&&q.quoteTime>0&&q.quoteTime<=this.now()+60000
    &&Number.isSafeInteger(q.receivedAt)&&q.receivedAt>=q.quoteTime
    &&Number.isFinite(q.minuteBps)&&q.minuteBps>0&&typeof q.source==="string";}
  async accept(quote:ReferenceQuote){
    const prior=this.quotes.get(quote.symbol);
    if(!this.valid(quote)||(prior&&quote.quoteTime<prior.quoteTime))return false;
    // Persist before publishing, so failed writes cannot silently lose a new anchor.
    await this.repository.save(quote);this.quotes.set(quote.symbol,{...quote});this.errors.delete(quote.symbol);return true;
  }
  private async publish(spec:MarketSpec,price:unknown,time:unknown,source:string,url:string,kind:ReferenceQuote["kind"]){
    const received=this.now(),prior=this.get(spec.symbol);
    const q:ReferenceQuote={symbol:spec.symbol,price:Number(price),quoteTime:Number(time),receivedAt:received,
      source,url,kind,minuteBps:prior?.minuteBps??spec.minuteBps,calibration:prior?.calibration??"Provisional class profile",
      sampleBars:prior?.sampleBars??0,session:spec.group==="Crypto"?"OPEN":spec.group==="India"?(indiaOpen(received)?"OPEN":"CLOSED"):"UNKNOWN"};
    if(!await this.accept(q))throw new Error(`Invalid or out-of-order quote: ${spec.symbol}`);
  }
  private members(group:Group){return MULTI_MARKETS.filter(s=>group==="crypto"?s.group==="Crypto":group==="rates"?s.group==="Forex"||["XAUUSD","XAGUSD"].includes(s.symbol):group==="indices"?s.group==="India":["WTI","BRENT"].includes(s.symbol));}
  private async yahoo(spec:MarketSpec){
    const url=`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahoo)}?interval=1d&range=5d`;
    const response=object(await this.transport(url)),result=object(array(object(response.chart).result)[0]),meta=object(result.meta);
    await this.publish(spec,meta.regularMarketPrice,Number(meta.regularMarketTime)*1000,"Yahoo public chart snapshot",url,
      spec.group==="Commodities"?"FUTURES_PROXY":"PUBLIC_DELAYED");
  }
  async poll(){
    if(this.busy)return;this.busy=true;
    try{for(const group of groups){
      if(this.now()<(this.due.get(group)??0))continue;
      const attemptedAt=this.now(),claimedDue=attemptedAt+interval[group]+this.jitter();
      // Persist before network IO; a crash cannot erase the provider cooldown.
      await this.repository.saveSchedule?.({group,attemptedAt,nextDueAt:claimedDue,failures:this.failures.get(group)??0});
      this.due.set(group,claimedDue);
      let failed=false;const specs=this.members(group);
      try{
        if(group==="crypto"){
          const url="https://data-api.binance.vision/api/v3/ticker/price?symbols="+encodeURIComponent(JSON.stringify(specs.map(s=>s.symbol)));
          const rows=array(await this.transport(url));
          for(const spec of specs){try{const row=object(rows.find(r=>object(r).symbol===spec.symbol));
            await this.publish(spec,row.price,this.now(),"Binance ticker (receipt timestamp)",url,"PUBLIC_QUOTE");
          }catch(error){failed=true;this.errors.set(spec.symbol,String(error));}}
        }else if(group==="rates"){
          const url="https://www.live-rates.com/rates",rows=this.options.keylessRates===false?[]:array(await this.transport(url).catch(()=>[]));
          for(const spec of specs){try{const row=object(rows.find(r=>String(object(r).currency).replaceAll("/","")===spec.symbol));
            if(!row.rate||!Number.isFinite(Number(row.timestamp))){await this.yahoo(spec);continue;}
            const ts=Number(row.timestamp);await this.publish(spec,row.rate,ts>1e12?ts:ts*1000,"Live-Rates public snapshot",url,"PUBLIC_DELAYED");
          }catch(error){failed=true;this.errors.set(spec.symbol,String(error));}}
        }else if(group==="indices"){
          const url="https://www.nseindia.com/api/allIndices",data=object(await this.transport(url).catch(()=>null));
          const names:Record<string,string>={NIFTY50:"NIFTY 50",BANKNIFTY:"NIFTY BANK",FINNIFTY:"NIFTY FINANCIAL SERVICES",NIFTYIT:"NIFTY IT",NIFTYMIDCAP100:"NIFTY MIDCAP 100"};
          for(const spec of specs){try{
            if(spec.symbol==="SENSEX"){await this.yahoo(spec);continue;}
            const row=object(array(data.data).find(r=>object(r).index===names[spec.symbol])),raw=row.timestamp??data.timestamp;
            const stamp=typeof raw==="string"?Date.parse(raw+(/IST|Z|[+]\d\d/.test(raw)?"":" GMT+0530")):NaN;
            if(!row.last||!Number.isFinite(stamp)){await this.yahoo(spec);continue;}
            await this.publish(spec,row.last,stamp,"NSE public index snapshot",url,"PUBLIC_DELAYED");
          }catch(error){failed=true;this.errors.set(spec.symbol,String(error));}}
        }else{for(const spec of specs){try{await this.yahoo(spec);}catch(error){failed=true;this.errors.set(spec.symbol,String(error));}}}
      }catch(error){failed=true;for(const spec of specs)this.errors.set(spec.symbol,String(error));}
      const failures=failed?Math.min(5,(this.failures.get(group)??0)+1):0;
      const nextDueAt=this.now()+Math.min(86400000,interval[group]*2**failures)+this.jitter();
      this.failures.set(group,failures);this.due.set(group,nextDueAt);
      await this.repository.saveSchedule?.({group,attemptedAt,nextDueAt,failures});
    }}finally{this.busy=false;}
  }
}
