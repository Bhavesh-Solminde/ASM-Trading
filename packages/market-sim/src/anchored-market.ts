import { OrderBook, type Execution, type Side } from "./order-book";
import type { Candle } from "./types";

export interface AnchoredProfile { symbol: string; price: number; minuteBps: number; tickSize: number; group: string; }
export interface AnchorUpdate { price: number; quoteTime: number; observedAt: number; }
export interface TobsFlowConfig { count:number; mix:"balanced"|"buy-heavy"|"sell-heavy"; arrival:"staggered"|"burst"; size:"small"|"medium"|"large"; durationMs:number; }
interface TobsEvent { time:number; actor:string; side:Side; requested:number; filled:number; }
class Random {
  constructor(private state:number){}
  checkpoint(){return this.state;}
  next(){this.state^=this.state<<13;this.state^=this.state>>>17;this.state^=this.state<<5;return (this.state>>>0)/4294967296;}
  normal(){return Math.sqrt(-2*Math.log(Math.max(1e-9,this.next())))*Math.cos(2*Math.PI*this.next());}
}
const clip=(v:number,low:number,high:number)=>Math.max(low,Math.min(high,v));
/** Neutral synthetic price discovery: no human positions, payouts or vault input. */
export class AnchoredMarket {
  book=new OrderBook();
  readonly botIds=Array.from({length:200},(_,i)=>`bot-${i}`);
  private random:Random;
  private clock:number;
  private nextTick:number;
  private fair:number;
  private anchor:AnchorUpdate;
  private last:Execution|null=null;
  private candles:Candle[]=[];
  private tape:(Execution&{origin:"Tobs"|"Bot"})[]=[];
  private journal:Execution[]=[];
  private phase="Push";
  private phaseTicks=0;
  private volatility=1;
  private noiseMemory=0;
  private fills=0;
  private orders=0;
  private tobsRandom:Random;
  private tobsIds:string[]=[];
  private externalIds:string[]=[];
  private observer:((fill:Execution)=>void)|undefined;
  private tobs:{config:TobsFlowConfig;startedAt:number;endsAt:number;nextOrderAt:number;index:number;startPrice:number;stoppedAt:number|null}|null=null;
  private tobsWindow:TobsEvent[]=[];
  private flowHistory:{time:number;phase:string;price:number}[]=[];
  private flowPhase="Bots only";
  private flowImpact=0;
  private tobsTotals={orders:0,requestedLots:0,matchedLots:0,buyLots:0,sellLots:0,fundLimited:0};
  constructor(readonly profile:AnchoredProfile,start:number,seed=1,initialGap=0,readonly audit=false) {
    if(!Number.isSafeInteger(start)||profile.price<=0||!Number.isFinite(profile.price)||profile.tickSize<=0||profile.minuteBps<=0||Math.abs(initialGap)>.5)throw new Error("Invalid anchored market configuration");
    this.random=new Random(seed||1);this.clock=start;this.nextTick=start;
    this.tobsRandom=new Random((seed^0x6a09e667)||7);
    this.fair=Math.log(profile.price*(1+initialGap));
    this.anchor={price:profile.price,quoteTime:0,observedAt:start};
    for(const id of this.botIds)this.book.register(id,1_000_000_000_000,1_000_000);
  }
  now(){return this.clock;}
  checkpoint(){
    return structuredClone({version:1 as const,profile:this.profile,audit:this.audit,
      book:this.book.checkpoint(),random:this.random.checkpoint(),tobsRandom:this.tobsRandom.checkpoint(),
      clock:this.clock,nextTick:this.nextTick,fair:this.fair,anchor:this.anchor,last:this.last,
      candles:this.candles,tape:this.tape,journal:this.journal,phase:this.phase,phaseTicks:this.phaseTicks,
      volatility:this.volatility,noiseMemory:this.noiseMemory,fills:this.fills,orders:this.orders,
      tobsIds:this.tobsIds,externalIds:this.externalIds,tobs:this.tobs,tobsWindow:this.tobsWindow,flowHistory:this.flowHistory,
      flowPhase:this.flowPhase,flowImpact:this.flowImpact,tobsTotals:this.tobsTotals});
  }
  static restore(input:ReturnType<AnchoredMarket["checkpoint"]>){
    const s=structuredClone(input);
    if(s.version!==1 || !Number.isSafeInteger(s.clock) || !Number.isSafeInteger(s.nextTick)
      || s.nextTick<=s.clock || s.nextTick>s.clock+6000 || ![s.fair,s.volatility,s.noiseMemory,s.flowImpact].every(Number.isFinite)
      || !Number.isInteger(s.random) || !Number.isInteger(s.tobsRandom)) throw new Error("Invalid market checkpoint");
    const market=new AnchoredMarket(s.profile,s.clock,1,0,s.audit);
    market.book=OrderBook.restore(s.book);market.random=new Random(s.random);market.tobsRandom=new Random(s.tobsRandom);
    const {version,profile,audit,book,random,tobsRandom,...fields}=s;
    Object.assign(market,fields);
    return market;
  }
  botLeaderboard(count=10){
    const mark=this.last?.price??Math.round(this.anchor.price/this.profile.tickSize);
    const initial=1e12+1e6*(this.profile.price/this.profile.tickSize);
    return this.botIds.map(id=>{
      const wallet=this.book.wallet(id),equity=wallet.cash+wallet.inventory*mark;
      // cash/inventory already include reserved balances: do not count them twice.
      return {id:`${this.profile.symbol}:${id}`,symbol:this.profile.symbol,
        pnl:(equity-initial)*this.profile.tickSize,returnPct:(equity/initial-1)*100};
    }).sort((a,b)=>b.returnPct-a.returnPct||a.id.localeCompare(b.id)).slice(0,count);
  }
  executeTob(actorId:string,side:Side,lots:number){
    if(!actorId || actorId.length>128 || !["BUY","SELL"].includes(side) || !Number.isSafeInteger(lots) || lots<1 || lots>240)throw new Error("Invalid Tob order");
    if(!this.last || this.clock-this.last.time>120000)throw new Error("Market price unavailable");
    const id=`tobs-user:${actorId}`;
    if(!this.externalIds.includes(id)){this.book.register(id,1e12,1e6);this.externalIds.push(id);}
    const opposing=this.book.depth(side==="BUY"?"SELL":"BUY",8);
    const reference=this.last.price,reach=Math.max(4,reference*this.profile.minuteBps/10000*2);
    const fills:Execution[]=[];
    this.observer=fill=>fills.push({...fill});
    let result:{filledLots:number;submittedLots:number};
    try{result=this.submit(id,side,side==="BUY"?reference+reach:Math.max(1,reference-reach),lots,this.clock,true);}
    finally{this.observer=undefined;}
    this.tobsWindow.push({time:this.clock,actor:id,side,requested:lots,filled:result.filledLots});
    this.tobsTotals.orders++;this.tobsTotals.requestedLots+=lots;this.tobsTotals.matchedLots+=result.filledLots;
    if(side==="BUY")this.tobsTotals.buyLots+=result.filledLots;else this.tobsTotals.sellLots+=result.filledLots;
    if(result.submittedLots<lots)this.tobsTotals.fundLimited++;
    if(result.filledLots)this.flowImpact+=(side==="BUY"?1:-1)*this.profile.minuteBps/10000/Math.sqrt(10)*.35*result.filledLots/Math.max(20,opposing.reduce((n,l)=>n+l.quantity,0));
    this.updateFlow(this.clock);
    return {fills,filledLots:result.filledLots,entryPrice:result.filledLots?fills.reduce((n,f)=>n+f.price*f.quantity,0)/result.filledLots*this.profile.tickSize:null};
  }
  quoteTob(actorId:string,side:Side,lots:number){
    if(!actorId || actorId.length>128 || !["BUY","SELL"].includes(side) || !Number.isSafeInteger(lots) || lots<1 || lots>240)throw new Error("Invalid Tob order");
    if(!this.last || this.clock-this.last.time>120000)throw new Error("Market price unavailable");
    const book=OrderBook.restore(this.book.checkpoint()),id=`tobs-user:${actorId}`;
    if(!this.externalIds.includes(id))book.register(id,1e12,1e6);
    const reference=this.last.price,reach=Math.max(4,reference*this.profile.minuteBps/10000*2);
    const price=Math.max(1,Math.round(side==="BUY"?reference+reach:Math.max(1,reference-reach)));
    const wallet=book.wallet(id),available=side==="BUY"?Math.floor((wallet.cash-wallet.reservedCash)/price):wallet.inventory-wallet.reservedInventory;
    const quantity=Math.min(lots,available);
    const fills=quantity>0?book.submit({ownerId:id,side,price,quantity,expiresAt:this.clock+36000,immediateOrCancel:true},this.clock):[];
    const filledLots=fills.reduce((n,f)=>n+f.quantity,0);
    return {filledLots,entryPrice:filledLots?fills.reduce((n,f)=>n+f.price*f.quantity,0)/filledLots*this.profile.tickSize:null};
  }
  startTobs(config:TobsFlowConfig){
    const keys=["count","mix","arrival","size","durationMs"];
    if(!config||Object.keys(config).length!==keys.length||Object.keys(config).some(k=>!keys.includes(k))||![1,10,20,40,100].includes(config.count)||!["balanced","buy-heavy","sell-heavy"].includes(config.mix)||!["staggered","burst"].includes(config.arrival)||!["small","medium","large"].includes(config.size)||![300000,900000,1800000].includes(config.durationMs))throw new Error("Choose a valid automated-tobs scenario");
    if(this.tobs&&this.clock<this.tobs.endsAt)throw new Error("A tobs scenario is already running in this market");
    if(!this.last)throw new Error("Wait for a market execution first");
    for(let i=this.tobsIds.length;i<config.count;i++){const id=`tobs-${i+1}`;this.book.register(id,1e12,1e6);this.tobsIds.push(id);}
    this.tobs={config:{...config},startedAt:this.clock,endsAt:this.clock+config.durationMs,nextOrderAt:this.nextTick,index:0,startPrice:this.last.price*this.profile.tickSize,stoppedAt:null};
    this.tobsWindow=[];this.tobsTotals={orders:0,requestedLots:0,matchedLots:0,buyLots:0,sellLots:0,fundLimited:0};this.flowHistory=[];this.flowPhase="Arriving";
    this.flowHistory.push({time:this.clock,phase:this.flowPhase,price:this.tobs.startPrice});
  }
  stopTobs(){if(this.tobs&&this.clock<this.tobs.endsAt){this.tobs.endsAt=this.clock;this.tobs.stoppedAt=this.clock;this.setFlowPhase("Recovery",this.clock);}}
  private setFlowPhase(phase:string,time:number){if(phase===this.flowPhase)return;this.flowPhase=phase;this.flowHistory.unshift({time,phase,price:(this.last?.price??0)*this.profile.tickSize});if(this.flowHistory.length>24)this.flowHistory.pop();}
  private runTobs(time:number,sigma:number){
    const scenario=this.tobs;
    if(scenario&&time<scenario.endsAt){
      const interval=scenario.config.arrival==="burst"?60000:60000/scenario.config.count;
      const batch=scenario.config.arrival==="burst"?scenario.config.count:1;
      let work=0;
      while(scenario.nextOrderAt<=time&&work<100){
        for(let i=0;i<batch;i++){
          const actor=this.tobsIds[scenario.index++%scenario.config.count]!;
          const buyChance=scenario.config.mix==="buy-heavy"?.85:scenario.config.mix==="sell-heavy"?.15:.5;
          const side:Side=this.tobsRandom.next()<buyChance?"BUY":"SELL";
          const size=scenario.config.size==="small"?5:scenario.config.size==="medium"?20:60;
          const opposing=this.book.depth(side==="BUY"?"SELL":"BUY",8),best=opposing[0];
          const reference=this.last?.price??Math.exp(this.fair)/this.profile.tickSize;
          const reach=Math.max(4,reference*this.profile.minuteBps/10000*2);
          const limit=side==="BUY"?reference+reach:Math.max(1,reference-reach);
          const result=this.submit(actor,side,limit,size,time,true);
          this.tobsTotals.orders++;this.tobsTotals.requestedLots+=size;this.tobsTotals.matchedLots+=result.filledLots;
          if(result.submittedLots<size)this.tobsTotals.fundLimited++;
          if(side==="BUY")this.tobsTotals.buyLots+=result.filledLots;else this.tobsTotals.sellLots+=result.filledLots;
          this.tobsWindow.push({time,actor,side,requested:size,filled:result.filledLots});
          // Filled flow changes future quote intentions, not the displayed price.
          // Unmatched requests cannot create either price impact or volume.
          if(result.filledLots&&best)this.flowImpact+=Math.sign(side==="BUY"?1:-1)*sigma*.35*result.filledLots/Math.max(20,opposing.reduce((n,l)=>n+l.quantity,0));
        }
        scenario.nextOrderAt+=interval;work+=batch;
      }
    }
    this.updateFlow(time);
  }
  private updateFlow(time:number){
    const scenario=this.tobs;
    this.tobsWindow=this.tobsWindow.filter(e=>e.time>time-60000);
    if(!scenario&&!this.tobsWindow.length){this.setFlowPhase("Bots only",time);return;}
    const external=this.tobsWindow.some(e=>e.actor.startsWith("tobs-user:"));
    if(scenario&&time>=scenario.endsAt&&!external){this.setFlowPhase(time-scenario.endsAt<90000?"Recovery":"Bots only",time);return;}
    const requested=this.tobsWindow.reduce((n,e)=>n+e.requested,0),matched=this.tobsWindow.reduce((n,e)=>n+e.filled,0);
    const signed=this.tobsWindow.reduce((n,e)=>n+(e.side==="BUY"?e.filled:-e.filled),0),imbalance=matched?signed/matched:0;
    const older=this.candles.filter(b=>b.time*1000<=time-60000).at(-1)?.close??scenario?.startPrice??this.profile.price;
    const changeBps=this.last?Math.log(this.last.price*this.profile.tickSize/older)*10000:0;
    const phase=!requested?"Arriving":matched/requested<.6?"Liquidity stress":Math.abs(imbalance)<.25?"Balanced flow":Math.abs(changeBps)<this.profile.minuteBps*.5?"Absorption":imbalance>0?"Buy pressure":"Sell pressure";
    this.setFlowPhase(phase,time);
  }
  private tobsSnapshot(){const config=this.tobs?.config,active=!!this.tobs&&this.clock<this.tobs.endsAt;
    const buy=this.tobsWindow.filter(e=>e.side==="BUY").reduce((n,e)=>n+e.filled,0),sell=this.tobsWindow.filter(e=>e.side==="SELL").reduce((n,e)=>n+e.filled,0);
    return {active,config:config?{...config}:null,startedAt:this.tobs?.startedAt??null,endsAt:this.tobs?.endsAt??null,startPrice:this.tobs?.startPrice??null,
      activeTobs:new Set(this.tobsWindow.map(e=>e.actor)).size,phase:this.flowPhase,buyLotsLastMinute:buy,sellLotsLastMinute:sell,
      netLotsLastMinute:buy-sell,...this.tobsTotals,participantsFunded:this.tobsIds.length+this.externalIds.length,events:this.flowHistory.map(e=>({...e}))};}
  setAnchor(value:AnchorUpdate):boolean {
    if(!Number.isFinite(value.price)||value.price<=0||!Number.isSafeInteger(value.quoteTime)||value.quoteTime>value.observedAt||value.observedAt>this.clock||value.quoteTime<this.anchor.quoteTime)return false;
    this.anchor={...value};return true;
  }
  private record(fill:Execution) {
    const time=Math.floor(fill.time/60000)*60,price=fill.price*this.profile.tickSize;
    let bar=this.candles.at(-1);
    if(!bar||bar.time!==time){const open=this.last?this.last.price*this.profile.tickSize:price;bar={time,open,high:Math.max(open,price),low:Math.min(open,price),close:price,volume:0};this.candles.push(bar);}
    bar.high=Math.max(bar.high,price);bar.low=Math.min(bar.low,price);bar.close=price;bar.volume+=fill.quantity;
    if(this.candles.length>1500)this.candles.shift();
    this.last={...fill};this.fills++;this.tape.unshift({...fill,origin:fill.takerId.startsWith("tobs-")||fill.makerId.startsWith("tobs-")?"Tobs":"Bot"});if(this.tape.length>40)this.tape.pop();
    if(this.audit)this.journal.push({...fill});
    this.observer?.({...fill});
  }
  private submit(id:string,side:Side,price:number,size:number,time:number,ioc=false){
    price=Math.max(1,Math.round(price));
    const wallet=this.book.wallet(id),available=side==="BUY"?Math.floor((wallet.cash-wallet.reservedCash)/price):wallet.inventory-wallet.reservedInventory;
    const quantity=Math.min(size,available);if(quantity<=0)return {filledLots:0,submittedLots:0};
    const fills=this.book.submit({ownerId:id,side,price,quantity,expiresAt:time+36000,immediateOrCancel:ioc},time);
    for(const fill of fills)this.record(fill);
    this.orders++;
    return {filledLots:fills.reduce((n,f)=>n+f.quantity,0),submittedLots:quantity};
  }
  private tick(time:number){
    this.book.expire(time);
    if(--this.phaseTicks<=0){const draw=this.random.next();this.phase=draw<.48?"Push":draw<.8?"Consolidation":"Pullback";this.phaseTicks=15+Math.floor(this.random.next()*40);this.volatility=.6+this.random.next()*1.1;}
    const phase=this.phase==="Push"?1:this.phase==="Consolidation"?.12:-.4;
    const group=this.profile.group;
    const minute=(time/60000)%1440,indiaTime=new Date(time+330*60000),weekday=indiaTime.getUTCDay();
    const session=group==="India"?(weekday>0&&weekday<6&&(minute+330)%1440>=555&&(minute+330)%1440<930?1.15:.55):group==="Forex"?(.65+.5*Math.max(0,Math.cos((minute-900)/1440*2*Math.PI))):1;
    const sigma=this.profile.minuteBps/10000/Math.sqrt(10)*session*this.volatility*(this.phase==="Consolidation"?.4:1);
    // Stable shared class factor + idiosyncratic shock: same-category markets
    // co-move partially, without identical traces or repeated candle templates.
    const t=Math.floor(time/6000),salt=group==="Crypto"?17:group==="India"?31:group==="Forex"?47:71;
    const sharedRandom=new Random((Math.imul(t,salt*104729)^0x3f4a751b)|0),shared=sharedRandom.normal();
    this.noiseMemory=.32*this.noiseMemory+.85*this.random.normal()+.25*shared;
    const error=Math.log(this.anchor.price)-this.fair;
    const drift=clip(error*.0016*phase,-sigma*2,sigma*2);
    const move=clip(drift+sigma*this.noiseMemory,-sigma*5,sigma*5);
    this.fair+=move;
    if(this.flowImpact){this.fair+=clip(this.flowImpact,-sigma*1.5,sigma*1.5);this.flowImpact*=.7;}
    const center=Math.exp(this.fair)/this.profile.tickSize;
    const spread=Math.max(2,center*this.profile.minuteBps/10000*.06);
    // Makers reprice finite resting limits, with several depth layers. Inventory
    // skew affects each maker independently; aggressive bots consume that depth.
    for(let i=0;i<12;i++){
      const id=this.botIds[i]!;this.book.cancelOwner(id,time);
      const inventory=(this.book.wallet(id).inventory-1_000_000)/1_000_000;
      const skew=clip(inventory,-.5,.5)*spread;
      const depth=spread*(.6+(i%6)*.6+this.random.next()*.5);
      this.submit(id,"BUY",center-depth-skew,5+Math.floor(this.random.next()*20),time);
      this.submit(id,"SELL",center+depth-skew,5+Math.floor(this.random.next()*20),time);
    }
    const last=this.last?.price??center;
    const buyProbability=clip(.5+(center-last)/Math.max(1,spread)*.08,.25,.75);
    for(let i=0;i<10;i++) {
      if(this.random.next()>.7)continue;
      const id=this.botIds[24+Math.floor(this.random.next()*176)]!;
      const side:Side=this.random.next()<buyProbability?"BUY":"SELL";
      const reach=spread*(1+this.random.next()*5);
      this.submit(id,side,center+(side==="BUY"?reach:-reach),2+Math.floor(this.random.next()*18),time,true);
    }
    this.runTobs(time,sigma);
    const bucket=Math.floor(time/60000)*60;
    if(this.last&&this.candles.at(-1)?.time!==bucket){const p=this.last.price*this.profile.tickSize;this.candles.push({time:bucket,open:p,high:p,low:p,close:p,volume:0});if(this.candles.length>1500)this.candles.shift();}
  }
  advance(time:number,onExecution?:(fill:Execution)=>void){
    if(!Number.isSafeInteger(time)||time<this.clock)throw new Error("Anchored time must be monotonic");
    this.observer=onExecution;
    try{while(this.nextTick<=time){this.tick(this.nextTick);this.nextTick+=6000;}this.clock=time;}
    finally{this.observer=undefined;}
  }
  executionAudit(){return this.journal.map(f=>({...f}));}
  closedCandlesAfter(after=-Infinity){
    const current=Math.floor(this.clock/60000)*60,result:Candle[]=[];
    for(let i=this.candles.length-1;i>=0;i--){const bar=this.candles[i]!;if(bar.time<=after)break;if(bar.time<current)result.push({...bar});}
    return result.reverse();
  }
  summary(){return {symbol:this.profile.symbol,time:this.clock,lastPrice:this.last?this.last.price*this.profile.tickSize:null,anchor:{...this.anchor},phase:this.phase,
    minuteBps:this.profile.minuteBps,botCount:this.botIds.length,activeHumans:0,orders:this.orders,fills:this.fills,
    gapPct:this.last?(this.last.price*this.profile.tickSize/this.anchor.price-1)*100:null};}
  snapshot(since?:number){return {...this.summary(),tobs:this.tobsSnapshot(),retainedFrom:this.candles[0]?.time??null,
    candles:(since===undefined?this.candles:this.candles.filter(b=>b.time>=since)).map(b=>({...b})),executions:this.tape.map(f=>({...f,price:f.price*this.profile.tickSize})),depth:{bids:this.book.depth("BUY",8).map(b=>({...b,price:b.price*this.profile.tickSize})),asks:this.book.depth("SELL",8).map(b=>({...b,price:b.price*this.profile.tickSize}))}};}
}
