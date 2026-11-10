export type OtcProtectionDraft={enabled:boolean;direction:"UP"|"DOWN";stopLoss:number|null;takeProfit:number|null};
export const EMPTY_OTC_PROTECTION:OtcProtectionDraft={enabled:false,direction:"UP",stopLoss:null,takeProfit:null};
export function snapProtection(price:number,tick:number,precision:number){return Number((Math.round(price/tick)*tick).toFixed(precision));}
export function protectionError(draft:OtcProtectionDraft,direction:"UP"|"DOWN",price:number|null){
  if(!draft.enabled)return null;
  if(draft.direction!==direction)return "Choose the trade direction in SL / TP, then adjust the chart lines.";
  if(!price||!draft.stopLoss||!draft.takeProfit||![draft.stopLoss,draft.takeProfit].every(p=>Number.isFinite(p)&&p>0))return "Wait for the chart, then drag the SL and TP lines.";
  const up=direction==="UP";
  if(up?draft.stopLoss>=price||draft.takeProfit<=price:draft.stopLoss<=price||draft.takeProfit>=price)return "The price moved past a protection line. Adjust SL / TP on the chart.";
  return null;
}
