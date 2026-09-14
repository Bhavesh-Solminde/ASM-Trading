import { z } from "zod";
import { SymbolSchema } from "./ws";

/** Mirrors DURATIONS_SEC in @asm/trading. Kept literal so contracts stays dependency-free. */
export const TRADE_DURATIONS_SEC = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400,
] as const;

export const DirectionSchema = z.enum(["UP", "DOWN"]);
export type DirectionDto = z.infer<typeof DirectionSchema>;

const tradeRequestShape = {
  symbol: SymbolSchema,
  direction: DirectionSchema,
  /** Minor units. Positive integer. */
  stake: z.number().int().positive().max(100_000_000),
  durationSec: z
    .number()
    .int()
    .refine((v) => (TRADE_DURATIONS_SEC as readonly number[]).includes(v), {
      message: "Duration is not one of the offered values",
    }),
  accountId: z.uuid(),
};

/**
 * Browser -> web app. Strict by design: a request carrying entryPrice,
 * expiryTs or payoutPct is rejected outright — those are server-determined,
 * and an attempt to supply them is worth logging, not silently discarding.
 */
export const OpenTradeSchema = z.strictObject(tradeRequestShape);
export type OpenTradeInput = z.infer<typeof OpenTradeSchema>;

/**
 * Web app -> engine, over loopback. The actor is added by the web app from
 * the verified session; it never comes from the browser.
 */
export const EngineOpenTradeSchema = z.strictObject({
  ...tradeRequestShape,
  actorId: z.uuid(),
});
export type EngineOpenTradeInput = z.infer<typeof EngineOpenTradeSchema>;

export type TradeStatusDto = "OPEN" | "WON" | "LOST" | "REFUNDED";

export interface TradeView {
  id: string;
  accountId: string;
  symbol: string;
  direction: DirectionDto;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  /** Epoch seconds. */
  entryTs: number;
  /** Epoch seconds. */
  expiryTs: number;
  exitPrice: number | null;
  status: TradeStatusDto;
  pnl: number;
}

export interface BalancesDto {
  realBalance: number;
  bonusBalance: number;
}

export interface OpenTradeResult {
  trade: TradeView;
  balances: BalancesDto;
}

/** The columns a trade row needs to be shown. Structural, so contracts never imports Prisma. */
export interface TradeRowLike {
  id: string;
  accountId: string;
  direction: DirectionDto;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: Date;
  expiryTs: Date;
  exitPrice: number | null;
  status: TradeStatusDto;
  pnl: number;
}

/**
 * The only way a trade row becomes client-facing JSON. Fields are copied one
 * at a time — never spread — so a column added to Trade later, or a joined
 * shadow record, cannot reach a trading client by accident.
 */
export function tradeViewFrom(row: TradeRowLike, symbol: string): TradeView {
  return {
    id: row.id,
    accountId: row.accountId,
    symbol,
    direction: row.direction,
    stake: row.stake,
    payoutPct: row.payoutPct,
    entryPrice: row.entryPrice,
    entryTs: Math.floor(row.entryTs.getTime() / 1000),
    expiryTs: Math.floor(row.expiryTs.getTime() / 1000),
    exitPrice: row.exitPrice,
    status: row.status,
    pnl: row.pnl,
  };
}
