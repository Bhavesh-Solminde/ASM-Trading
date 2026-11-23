import { z } from "zod";
import { OpenTradeSchema } from "./trade";
import { AuthMessageSchema,LoadOlderMessageSchema,SubscribeMessageSchema,UnsubscribeMessageSchema,WatchlistMessageSchema,type CandleDto,type Timeframe } from "./ws";

export const OtcOpenTradeSchema=OpenTradeSchema.extend({idempotencyKey:z.uuid(),quoteToken:z.uuid(),stopLoss:z.number().positive().finite().nullable().optional(),takeProfit:z.number().positive().finite().nullable().optional()});
export const EngineOtcOpenTradeSchema=OtcOpenTradeSchema.extend({actorId:z.uuid()});
export type OtcOpenTradeInput=z.infer<typeof OtcOpenTradeSchema>;
export type EngineOtcOpenTradeInput=z.infer<typeof EngineOtcOpenTradeSchema>;

export const OtcSetStopsSchema = z.strictObject({
  requestId: z.uuid(),
  stopLoss: z.number().positive().finite().nullable(),
  takeProfit: z.number().positive().finite().nullable(),
});
export const OtcTradeIdSchema = z.uuid();
export const EngineOtcSetStopsSchema = OtcSetStopsSchema.extend({ actorId: z.uuid() });
export type OtcSetStopsInput = z.infer<typeof OtcSetStopsSchema>;
export type EngineOtcSetStopsInput = z.infer<typeof EngineOtcSetStopsSchema>;
/** Opens a fixed OTC trade over the already-authenticated engine socket; the actor comes from the socket, never the client. */
export const OtcTradeOpenRequestSchema=OtcOpenTradeSchema.extend({type:z.literal("trade:open")});
/** Everything the OTC engine socket accepts: the shared chart messages plus trade:open. */
export const OtcClientMessageSchema=z.discriminatedUnion("type",[AuthMessageSchema,SubscribeMessageSchema,UnsubscribeMessageSchema,LoadOlderMessageSchema,WatchlistMessageSchema,OtcTradeOpenRequestSchema]);
export type OtcClientMessage=z.infer<typeof OtcClientMessageSchema>;
export interface OtcDisplayQuote { token:string;price:number;expiresAt:number; }
export interface OtcMarketMessage {
  type:"otc:market";generation:string;symbol:string;timeframe:Timeframe;time:number;sequence:number;
  reset:boolean;retainedFrom:number|null;candles:CandleDto[];
  reference:{price:number;source:string;quoteTime:number;receivedAt:number;kind:string;status:string}|null;
  depth:{bids:{price:number;quantity:number;orders:number}[];asks:{price:number;quantity:number;orders:number}[]};
  tape:{sequence:number;time:number;price:number;quantity:number;side:"BUY"|"SELL";origin:"Tobs"|"Bot"}[];
  phase:string;activeTobs:number;openTobs?:number;
  displayQuote?:OtcDisplayQuote|null;
}
export interface OtcWatchlistMessage {type:"otc:watchlist";rows:{symbol:string;price:number|null;payoutPct:number}[];}
export interface OtcBotsMessage {type:"otc:bots";rows:{id:string;symbol:string;pnl:number;returnPct:number}[];}
