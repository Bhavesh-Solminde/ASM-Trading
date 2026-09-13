import { z } from "zod";

/** Asset symbols are uppercase alphanumerics and underscores only. */
export const SymbolSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_]+$/, "Symbol must be uppercase letters, digits, or underscore");

export const TimeframeSchema = z.enum(["1m", "5m", "15m"]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const CandleSchema = z.strictObject({
  openTs: z.number().int(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
});
export type CandleDto = z.infer<typeof CandleSchema>;

// ---------- client -> server ----------

export const AuthMessageSchema = z.strictObject({
  type: z.literal("auth"),
  token: z.string().min(1).max(512),
});

export const SubscribeMessageSchema = z.strictObject({
  type: z.literal("subscribe"),
  symbol: SymbolSchema,
  timeframe: TimeframeSchema,
});

export const UnsubscribeMessageSchema = z.strictObject({
  type: z.literal("unsubscribe"),
  symbol: SymbolSchema,
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- server -> client ----------
// Outbound messages are constructed by the server, never parsed from input, so
// they are plain types rather than schemas.

export interface TickMessage {
  type: "tick";
  symbol: string;
  price: number;
  ts: number;
}

export interface CandleHistoryMessage {
  type: "candles:history";
  symbol: string;
  timeframe: Timeframe;
  candles: CandleDto[];
}

export interface CandleCloseMessage {
  type: "candle:close";
  symbol: string;
  timeframe: Timeframe;
  candle: CandleDto;
}

export interface PayoutUpdateMessage {
  type: "payout:update";
  symbol: string;
  payoutPct: number;
}

export interface ReadyMessage {
  type: "ready";
  serverTs: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | TickMessage
  | CandleHistoryMessage
  | CandleCloseMessage
  | PayoutUpdateMessage
  | ReadyMessage
  | ErrorMessage;
