import type { AnchoredMarket } from "./anchored-market";
import { isTob,type AccountActor } from "./eligibility";
import type { Side } from "./order-book";

export interface AccountFlowInput extends AccountActor {
  actorId:string;
  side:Side;
  /** Converted by the server from the account currency, never supplied by the browser. */
  stakeInrMinor:number;
}

export function flowLots(stakeInrMinor:number){
  if(!Number.isSafeInteger(stakeInrMinor)||stakeInrMinor<1)throw new Error("Invalid stake scale");
  return Math.min(240,Math.max(1,Math.ceil(stakeInrMinor/500)));
}

/** Role and accountType must be resolved from the authenticated database account. */
export function submitAccountFlow(market:AnchoredMarket,input:AccountFlowInput){
  if(!Number.isSafeInteger(input.stakeInrMinor)||input.stakeInrMinor<1)throw new Error("Invalid stake scale");
  if(!isTob(input)){
    const price=market.summary().lastPrice;
    if(!price)throw new Error("Market price unavailable");
    // Paper positions observe the published price; not even a wallet is created.
    return {origin:"PAPER" as const,entryPrice:price,filledLots:0,requestedLots:0,fills:[]};
  }
  const lots=flowLots(input.stakeInrMinor);
  return {origin:"Tob" as const,requestedLots:lots,...market.executeTob(input.actorId,input.side,lots)};
}
