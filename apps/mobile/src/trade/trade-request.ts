import { z } from "zod";
import { OpenTradeSchema, type OpenTradeInput, type OpenTradeResult } from "@asm/contracts";
import { TradeViewSchema } from "@/socket/trades";

/** The `POST /api/trades` response. The annotation makes drift from the contract a compile error. */
export const OpenTradeResultSchema: z.ZodType<OpenTradeResult> = z.object({
  trade: TradeViewSchema,
  balances: z.object({ realBalance: z.number(), bonusBalance: z.number() }),
});

/** The request body, validated against the contract before it is sent (throws a ZodError if it would be rejected). */
export function buildOpenTradeBody(input: {
  accountId: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stakeMinor: number;
  durationSec: number;
}): OpenTradeInput {
  return OpenTradeSchema.parse({
    symbol: input.symbol,
    direction: input.direction,
    stake: input.stakeMinor,
    durationSec: input.durationSec,
    accountId: input.accountId,
  });
}
