import { z } from "zod";
import { CandleSchema, TimeframeSchema, type BalancesDto, type CandleDto, type Timeframe, type TradeView } from "@asm/contracts";
import { TradeViewSchema } from "@/socket/trades";

/**
 * What the Trade screen needs to paint before the socket is up. It holds balances and trades, never the
 * session token (and nothing here may be logged).
 */
export interface ResumeSnapshot {
  v: 1;
  savedAt: number;
  userId: string;
  symbol: string;
  timeframe: Timeframe;
  candles: CandleDto[];
  balances: Record<string, BalancesDto>;
  openTrades: TradeView[];
  accountId: string;
  /** The market's price decimals, so the axis is right before bootstrap. Absent in snapshots saved before it existed. */
  precision?: number;
  /** The saved account's type and currency, so its balance can be formatted before bootstrap. Absent in older snapshots. */
  account?: { type: "DEMO" | "LIVE"; currency: string };
}

export const MAX_AGE_MS = 24 * 3600 * 1000;
export const KEEP_CANDLES = 200;
/** Tolerated clock skew; a snapshot saved further in the future means the clock was moved back. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Annotated so drift from the `ResumeSnapshot` type is a compile error. Unknown keys are stripped. */
const ResumeSchema: z.ZodType<ResumeSnapshot> = z.object({
  v: z.literal(1),
  savedAt: z.number(),
  userId: z.string(),
  symbol: z.string(),
  timeframe: TimeframeSchema,
  candles: z.array(CandleSchema),
  balances: z.record(z.string(), z.object({ realBalance: z.number(), bonusBalance: z.number() })),
  openTrades: z.array(TradeViewSchema),
  accountId: z.string(),
  precision: z.number().int().min(0).max(12).optional(),
  account: z.object({ type: z.enum(["DEMO", "LIVE"]), currency: z.string().min(1) }).optional(),
});

export function encodeResume(s: ResumeSnapshot): string {
  return JSON.stringify({ ...s, candles: s.candles.slice(-KEEP_CANDLES) });
}

/**
 * Null for anything that is not a fresh, well-formed snapshot: missing, corrupt, wrong version or shape,
 * older than a day, saved in the future, or (when `expectedUserId` is given) another user's.
 */
export function decodeResume(raw: string | undefined, now: number, expectedUserId?: string): ResumeSnapshot | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ResumeSchema.safeParse(json);
  if (!parsed.success) return null;
  const s = parsed.data;
  if (expectedUserId !== undefined && s.userId !== expectedUserId) return null;
  if (now - s.savedAt > MAX_AGE_MS || s.savedAt - now > FUTURE_SKEW_MS) return null;
  return { ...s, candles: s.candles.slice(-KEEP_CANDLES) };
}
