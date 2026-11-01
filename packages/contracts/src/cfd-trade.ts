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
  /** Units the client used; optional for older clients, enforced again in the debit transaction. */
  currency: z.enum(["INR", "USD"]).optional(),
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
  leverage?: number;
  entryPrice: number;
  entryTs: number;
  expiryTs: number;
  /** Actual close time (older engine events may omit it). */
  closedTs?: number | null | undefined;
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

/** Validated native/API position shape; never interprets a CFD as a fixed payout option. */
export const CfdTradeViewSchema = z.object({
  id: z.string(), accountId: z.string(), symbol: SymbolSchema, direction: CfdDirectionSchema,
  stake: z.number().int().nonnegative(), spreadFee: z.number().int().nonnegative().default(0),
  leverage: z.number().positive().default(1), entryPrice: z.number().positive(),
  entryTs: z.number(), expiryTs: z.number(), closedTs: z.number().nullable().optional(), exitPrice: z.number().nullable(),
  stopLoss: z.number().nullable(), takeProfit: z.number().nullable(), trailingPct: z.number().nullable(),
  liqPrice: z.number(), closeReason: z.enum(["DURATION", "STOP_LOSS", "TAKE_PROFIT", "MANUAL", "LIQUIDATION", "TRAILING_STOP"]).nullable(),
  status: z.enum(["OPEN", "CLOSED"]), pnl: z.number().int(),
});

export function cfdTradeViewFrom(row: {
  id: string; accountId: string; direction: string; stake: number; spreadFee: number; leverage: number;
  entryPrice: number; entryTs: Date; expiryTs: Date; exitPrice: number | null;
  stopLoss: number | null; takeProfit: number | null; trailingPct: number | null; liqPrice: number | null;
  closeReason: string | null; status: string; pnl: number; closedAt?: Date | null;
}, symbol: string): CfdTradeView {
  return CfdTradeViewSchema.parse({
    id: row.id, accountId: row.accountId, symbol, direction: directionFromDb(row.direction as "UP" | "DOWN"),
    stake: row.stake, spreadFee: row.spreadFee, leverage: row.leverage, entryPrice: row.entryPrice,
    entryTs: Math.floor(row.entryTs.getTime() / 1000), expiryTs: Math.floor(row.expiryTs.getTime() / 1000),
    closedTs: row.closedAt ? Math.floor(row.closedAt.getTime() / 1000) : null,
    exitPrice: row.exitPrice, stopLoss: row.stopLoss, takeProfit: row.takeProfit, trailingPct: row.trailingPct,
    liqPrice: row.liqPrice ?? 0, closeReason: row.closeReason, status: row.status === "OPEN" ? "OPEN" : "CLOSED", pnl: row.pnl,
  });
}
