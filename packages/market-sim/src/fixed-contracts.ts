export interface FixedContractInput {
  id:string;
  accountId:string;
  actorId:string;
  symbol:string;
  direction:"UP"|"DOWN";
  stake:number;
  entryPrice:number;
  entryTime:number;
  expiryTime:number;
  entrySequence:number;
  stopLoss?:number|null;
  takeProfit?:number|null;
}
export interface FixedContract extends FixedContractInput {
  payoutPct:92;
  status:"OPEN"|"WON"|"LOST"|"REFUNDED";
  lastPrice:number;
  lastSequence:number;
  exitPrice:number|null;
  settledTime:number|null;
  reason:"STOP_LOSS"|"TAKE_PROFIT"|"DURATION"|null;
  credit:number;
  pnl:number;
}
export interface PublishedExecution {symbol:string;price:number;time:number;sequence:number;}

/** Execution-driven fixed-payout contracts. Contains no price-making code. */
export class FixedContracts {
  private positions=new Map<string,FixedContract>();
  open(input:FixedContractInput){
    if(this.positions.has(input.id))throw new Error("Duplicate contract");
    const positive=(v:number)=>Number.isFinite(v)&&v>0;
    if(!input.id||!input.accountId||!input.actorId||!input.symbol||!["UP","DOWN"].includes(input.direction)
      ||!Number.isSafeInteger(input.stake)||input.stake<1||input.stake>100000000
      ||!positive(input.entryPrice)||!Number.isSafeInteger(input.entryTime)||!Number.isSafeInteger(input.expiryTime)
      ||input.expiryTime<=input.entryTime||!Number.isSafeInteger(input.entrySequence)||input.entrySequence<0)throw new Error("Invalid fixed contract");
    const up=input.direction==="UP";
    if(input.stopLoss!=null&&(!positive(input.stopLoss)||(up?input.stopLoss>=input.entryPrice:input.stopLoss<=input.entryPrice)))throw new Error("Invalid stop loss");
    if(input.takeProfit!=null&&(!positive(input.takeProfit)||(up?input.takeProfit<=input.entryPrice:input.takeProfit>=input.entryPrice)))throw new Error("Invalid take profit");
    const contract:FixedContract={...input,payoutPct:92,status:"OPEN",lastPrice:input.entryPrice,lastSequence:input.entrySequence,
      exitPrice:null,settledTime:null,reason:null,credit:0,pnl:0};
    this.positions.set(input.id,contract);return {...contract};
  }
  private settle(p:FixedContract,status:FixedContract["status"],reason:FixedContract["reason"],price:number,time:number){
    p.status=status;p.reason=reason;p.exitPrice=price;p.settledTime=time;
    p.credit=status==="REFUNDED"?p.stake:status==="WON"?Number(BigInt(p.stake)*192n/100n):0;
    p.pnl=p.credit-p.stake;
  }
  private expire(p:FixedContract){
    const status=p.lastPrice===p.entryPrice?"REFUNDED":((p.direction==="UP")===(p.lastPrice>p.entryPrice)?"WON":"LOST");
    this.settle(p,status,"DURATION",p.lastPrice,p.expiryTime);
  }
  observe(fill:PublishedExecution){
    if(!Number.isFinite(fill.price)||fill.price<=0||!Number.isSafeInteger(fill.time)||!Number.isSafeInteger(fill.sequence))throw new Error("Invalid published execution");
    for(const p of this.positions.values()){
      if(p.status!=="OPEN"||p.symbol!==fill.symbol||fill.sequence<=p.lastSequence||fill.time<p.entryTime)continue;
      // A later tick cannot become the expiry price retroactively.
      if(fill.time>p.expiryTime){this.expire(p);continue;}
      p.lastPrice=fill.price;p.lastSequence=fill.sequence;
      const up=p.direction==="UP";
      if(p.stopLoss!=null&&(up?fill.price<=p.stopLoss:fill.price>=p.stopLoss))this.settle(p,"LOST","STOP_LOSS",fill.price,fill.time);
      else if(p.takeProfit!=null&&(up?fill.price>=p.takeProfit:fill.price<=p.takeProfit))this.settle(p,"WON","TAKE_PROFIT",fill.price,fill.time);
    }
  }
  advance(time:number){if(!Number.isSafeInteger(time))throw new Error("Invalid settlement time");for(const p of this.positions.values())if(p.status==="OPEN"&&p.expiryTime<=time)this.expire(p);}
  get(id:string){const p=this.positions.get(id);return p?{...p}:null;}
  checkpoint(){return [...this.positions.values()].map(p=>({...p}));}
  static restore(state:FixedContract[]){
    const book=new FixedContracts();
    for(const p of state){book.open(p);
      if(!["OPEN","WON","LOST","REFUNDED"].includes(p.status)||!Number.isFinite(p.lastPrice)||p.lastPrice<=0
        ||!Number.isSafeInteger(p.lastSequence)||p.lastSequence<p.entrySequence
        ||!Number.isSafeInteger(p.credit)||p.credit<0||p.pnl!==p.credit-(p.status==="OPEN"?0:p.stake))throw new Error("Invalid contract checkpoint");
      book.positions.set(p.id,{...p});}
    return book;
  }
  pendingSettlements(){return this.checkpoint().filter(p=>p.status!=="OPEN");}
  acknowledge(id:string){const p=this.positions.get(id);if(p&&p.status!=="OPEN")this.positions.delete(id);}
}
