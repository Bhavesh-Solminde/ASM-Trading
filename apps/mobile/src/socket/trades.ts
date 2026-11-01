import { z } from "zod";
import type { TradeView } from "@asm/contracts";

/**
 * `Bootstrap.recentTrades` is typed as loose records (the contract defers validation to the engine), so
 * the app checks the TradeView shape here. The annotation makes drift from the contract a compile error.
 */
export const TradeViewSchema: z.ZodType<TradeView> = z.object({
  id: z.string(),
  accountId: z.string(),
  symbol: z.string(),
  direction: z.enum(["UP", "DOWN"]),
  stake: z.number(),
  payoutPct: z.number(),
  entryPrice: z.number(),
  entryTs: z.number(),
  expiryTs: z.number(),
  exitPrice: z.number().nullable(),
  status: z.enum(["OPEN", "WON", "LOST", "REFUNDED"]),
  pnl: z.number(),
});

/** Valid trades only; a malformed row is skipped rather than failing the whole bootstrap. */
export function parseTrades(raw: readonly unknown[]): TradeView[] {
  const out: TradeView[] = [];
  for (const row of raw) {
    // CFD rows have their own book and variable P/L. Never feed them to binary payoff logic.
    if (row && typeof row === "object" && "durationSec" in row && row.durationSec != null) continue;
    const parsed = TradeViewSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
