import { z } from "zod";
import type { TradeView } from "./trade";

/** Asset symbols are uppercase alphanumerics and underscores only. */
export const SymbolSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_]+$/, "Symbol must be uppercase letters, digits, or underscore");

// Only 1m candles are aggregated and persisted; widen when resampling exists.
export const TimeframeSchema = z.enum(["1m"]);
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

/**
 * Asks for candles strictly older than `before` (a closed candle's `openTs`,
 * in seconds) — the chart sends this when the user scrolls past the earliest
 * bar it holds, so history is fetched lazily instead of all at subscribe time.
 */
export const LoadOlderMessageSchema = z.strictObject({
  type: z.literal("candles:loadOlder"),
  symbol: SymbolSchema,
  timeframe: TimeframeSchema,
  before: z.number().int(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  LoadOlderMessageSchema,
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

/**
 * Reply to `candles:loadOlder` — a batch of candles older than the requested
 * `before`, oldest first, for the client to prepend. `reachedStart` is true
 * when the store returned fewer than the requested limit, i.e. there is no
 * more history before this batch.
 */
export interface CandleOlderMessage {
  type: "candles:older";
  symbol: string;
  timeframe: Timeframe;
  candles: CandleDto[];
  reachedStart: boolean;
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

/** Sent once, after a ticket is accepted. Clients subscribe only after receiving it. */
export interface AuthedMessage {
  type: "authed";
}

export interface TradeOpenedMessage {
  type: "trade:opened";
  trade: TradeView;
}

export interface TradeSettledMessage {
  type: "trade:settled";
  trade: TradeView;
}

export interface BalanceUpdateMessage {
  type: "balance:update";
  accountId: string;
  realBalance: number;
  bonusBalance: number;
}

export interface SentimentMessage {
  type: "sentiment";
  symbol: string;
  /** Whole percentages summing to 100. */
  upPct: number;
  downPct: number;
}

export type ServerMessage =
  | TickMessage
  | CandleHistoryMessage
  | CandleCloseMessage
  | CandleOlderMessage
  | PayoutUpdateMessage
  | ReadyMessage
  | ErrorMessage
  | AuthedMessage
  | TradeOpenedMessage
  | TradeSettledMessage
  | BalanceUpdateMessage
  | SentimentMessage;
