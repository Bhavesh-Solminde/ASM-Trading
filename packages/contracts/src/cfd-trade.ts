import { z } from "zod";
import { SymbolSchema } from "./ws";

export const CfdDirectionSchema = z.enum(["LONG", "SHORT"]);
export type CfdDirectionDto = z.infer<typeof CfdDirectionSchema>;

export function directionToDb(d: CfdDirectionDto): "UP" | "DOWN" {
  return d === "LONG" ? "UP" : "DOWN";
}

export function directionFromDb(d: "UP" | "DOWN"): CfdDirectionDto {
  return d === "UP" ? "LONG" : "SHORT";
}

export const CfdOpenTradeSchema = z.strictObject({
  symbol: SymbolSchema,
  direction: CfdDirectionSchema,
  stake: z.number().int().positive().max(100_000_000),
  durationSec: z.number().int().min(5).max(3600),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  trailingPct: z.number().positive().max(50).optional(),
  stopLossPct: z.number().positive().max(99.99).optional(),
  takeProfitPct: z.number().positive().max(1000).optional(),
  accountId: z.string().uuid(),
});
export type CfdOpenTradeInput = z.infer<typeof CfdOpenTradeSchema>;

export const EngineCfdOpenTradeSchema = CfdOpenTradeSchema.extend({
  actorId: z.string().uuid(),
});
export type EngineCfdOpenTradeInput = z.infer<typeof EngineCfdOpenTradeSchema>;

export const CfdCloseTradeSchema = z.strictObject({
  tradeId: z.string().uuid(),
});
export type CfdCloseTradeInput = z.infer<typeof CfdCloseTradeSchema>;

export const CfdModifyTradeSchema = z.strictObject({
  tradeId: z.string().uuid(),
  stopLoss: z.number().positive().nullable().optional(),
  takeProfit: z.number().positive().nullable().optional(),
});
export type CfdModifyTradeInput = z.infer<typeof CfdModifyTradeSchema>;

export type CfdCloseReasonDto =
  | "DURATION"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "MANUAL"
  | "LIQUIDATION"
  | "TRAILING_STOP";

export type CfdTradeStatusDto = "OPEN" | "CLOSED";

export interface CfdTradeView {
  id: string;
  accountId: string;
  symbol: string;
  direction: CfdDirectionDto;
  stake: number;
  /** Opening fee in minor units, already deducted from balance. */
  spreadFee?: number;
  entryPrice: number;
  entryTs: number;
  expiryTs: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingPct: number | null;
  liqPrice: number;
  closeReason: CfdCloseReasonDto | null;
  status: CfdTradeStatusDto;
  pnl: number;
}

export interface CfdOpenTradeResult {
  trade: CfdTradeView;
  balances: { realBalance: number; bonusBalance: number };
}
