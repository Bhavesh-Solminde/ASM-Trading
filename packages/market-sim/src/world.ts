import { AnchoredMarket } from "./anchored-market";
import { MULTI_MARKETS,type ReferenceQuote } from "./catalogue";
import { FixedContracts,type FixedContract,type FixedContractInput } from "./fixed-contracts";
import { flowLots,submitAccountFlow,type AccountFlowInput } from "./account-flow";
import { isTob } from "./eligibility";
import type { Execution } from "./order-book";

export interface OpenContractCommand extends Omit<FixedContractInput,"entryPrice"|"entryTime"|"expiryTime"|"entrySequence">,Omit<AccountFlowInput,"side"> {
  durationSec:number;
  /** Verified displayed price. Absent only in durable commands from older releases. */
  displayedPrice?:number;
}
export interface OpenContractResult {contract:FixedContract;flowLots:number;filledLots:number;}
export interface SimulationCheckpoint {
  version:1;
  time:number;
  sequence:number;
  markets:ReturnType<AnchoredMarket["checkpoint"]>[];
  references:ReferenceQuote[];
  contracts:FixedContract[];
}

/** Single serialized world. Only its host does IO, authentication and accounting. */
export class MarketWorld {
  readonly markets=new Map<string,AnchoredMarket>();
  readonly references=new Map<string,ReferenceQuote>();
  contracts=new FixedContracts();
  time:number;
  sequence=0;
  private executionObserver?: (symbol:string,fill:Execution,tickSize:number)=>void;
  /** Optional host audit sink; never changes matching or contract decisions. */
  observeExecutions(observer:(symbol:string,fill:Execution,tickSize:number)=>void){this.executionObserver=observer;}
  constructor(start:number,references:ReferenceQuote[]=[],seed=503){
    if(!Number.isSafeInteger(start)||start<2700000)throw new Error("Invalid world start");
    this.time=start;
    for(const q of references)this.references.set(q.symbol,{...q});
    for(const [i,s] of MULTI_MARKETS.entries()){
      const q=this.references.get(s.symbol);
      const market=new AnchoredMarket({symbol:s.symbol,price:q?.price??s.base,minuteBps:q?.minuteBps??s.minuteBps,tickSize:10**-s.precision,group:s.group},start-2700000,seed+i);
      market.advance(start);this.markets.set(s.symbol,market);
      if(q)market.setAnchor({price:q.price,quoteTime:start,observedAt:start});
    }
  }
  private market(symbol:string){const market=this.markets.get(symbol);if(!market)throw new Error("Unknown market");return market;}
  advance(time:number,recordCommand=true){
    if(!Number.isSafeInteger(time)||time<this.time)throw new Error("World time must be monotonic");
    for(const m of this.markets.values())m.advance(time,f=>{
      this.contracts.observe({symbol:m.profile.symbol,price:f.price*m.profile.tickSize,time:f.time,sequence:f.sequence});
      this.executionObserver?.(m.profile.symbol,f,m.profile.tickSize);
    });
    this.contracts.advance(time);this.time=time;if(recordCommand)this.sequence++;
  }
  reference(quote:ReferenceQuote){
    const market=this.market(quote.symbol),prior=this.references.get(quote.symbol);
    if(!Number.isFinite(quote.price)||quote.price<=0||!Number.isFinite(quote.minuteBps)||quote.minuteBps<=0||!Number.isSafeInteger(quote.quoteTime)
      ||quote.quoteTime>quote.receivedAt||quote.receivedAt>this.time||(prior&&quote.quoteTime<prior.quoteTime))throw new Error("Invalid reference update");
    // The real provider timestamp stays in reference metadata. Simulation inputs
    // become observable now, without applying a future quote to historical ticks.
    if(!market.setAnchor({price:quote.price,quoteTime:this.time,observedAt:this.time}))throw new Error("Reference was not applied");
    market.profile.minuteBps=quote.minuteBps;
    this.references.set(quote.symbol,{...quote});this.sequence++;
  }
  open(input:OpenContractCommand):OpenContractResult{
    if(this.contracts.get(input.id))throw new Error("Duplicate contract");
    if(![5,10,15,30,60,120,300,600,900,1800,3600,7200,14400].includes(input.durationSec))throw new Error("Invalid duration");
    const m=this.market(input.symbol),side=input.direction==="UP"?"BUY":"SELL";
    const lots=flowLots(input.stakeInrMinor);
    const quote=isTob(input)?m.quoteTob(input.actorId,side,lots):{entryPrice:m.summary().lastPrice,filledLots:0};
    if(!quote.entryPrice)throw new Error("Liquidity unavailable");
    const request:FixedContractInput={id:input.id,accountId:input.accountId,actorId:input.actorId,symbol:input.symbol,direction:input.direction,
      stake:input.stake,entryPrice:input.displayedPrice??quote.entryPrice,entryTime:this.time,expiryTime:this.time+input.durationSec*1000,entrySequence:m.book.sequence,
      ...(input.stopLoss!==undefined?{stopLoss:input.stopLoss}:{}),...(input.takeProfit!==undefined?{takeProfit:input.takeProfit}:{})};
    // Validate accepted contract levels before changing the book.
    new FixedContracts().open(request);
    const flow=submitAccountFlow(m,{...input,side});
    if(flow.entryPrice!==quote.entryPrice||flow.filledLots!==quote.filledLots)throw new Error("Order preview diverged from execution");
    for(const f of flow.fills){
      this.contracts.observe({symbol:input.symbol,price:f.price*m.profile.tickSize,time:f.time,sequence:f.sequence});
      this.executionObserver?.(input.symbol,f,m.profile.tickSize);
    }
    const contract=this.contracts.open({...request,entrySequence:m.book.sequence});this.sequence++;
    return {contract,flowLots:flow.requestedLots,filledLots:flow.filledLots};
  }
  snapshot(symbol:string,since?:number){return {time:this.time,sequence:this.sequence,market:this.market(symbol).snapshot(since),reference:this.references.get(symbol)??null};}
  summaries(){return [...this.markets.values()].map(m=>m.summary());}
  leaderboard(){return [...this.markets.values()].flatMap(m=>m.botLeaderboard(10)).sort((a,b)=>b.returnPct-a.returnPct||a.id.localeCompare(b.id)).slice(0,10);}
  checkpoint():SimulationCheckpoint{return {version:1,time:this.time,sequence:this.sequence,markets:[...this.markets.values()].map(m=>m.checkpoint()),references:[...this.references.values()].map(q=>({...q})),contracts:this.contracts.checkpoint()};}
  static restore(state:SimulationCheckpoint){
    if(state.version!==1||!Number.isSafeInteger(state.time)||!Number.isSafeInteger(state.sequence)||state.sequence<0||state.markets.length!==MULTI_MARKETS.length)throw new Error("Invalid simulation checkpoint");
    // Avoid warm-up on recovery; the restored world must consume no random draws.
    const world=Object.create(MarketWorld.prototype) as MarketWorld;
    Object.assign(world,{time:state.time,sequence:state.sequence,markets:new Map(),references:new Map(),contracts:FixedContracts.restore(state.contracts)});
    for(const s of state.markets){if(s.clock!==state.time||!MULTI_MARKETS.some(m=>m.symbol===s.profile.symbol)||world.markets.has(s.profile.symbol))throw new Error("Checkpoint market mismatch");world.markets.set(s.profile.symbol,AnchoredMarket.restore(s));}
    for(const q of state.references)world.references.set(q.symbol,{...q});
    return world;
  }
}
