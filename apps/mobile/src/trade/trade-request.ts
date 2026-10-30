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
  /**
   * The selected account's currency, as this device last saw it. The server refuses the trade (`currency_changed`)
   * when the account has been converted since, so a stake typed in the old currency is never placed in the new one.
   */
  currency: string;
}): OpenTradeInput {
  // A currency the contract does not know is left out rather than failing every trade; the server still checks the stake.
  const currency = OpenTradeSchema.shape.currency.safeParse(input.currency);
  return OpenTradeSchema.parse({
    symbol: input.symbol,
    direction: input.direction,
    stake: input.stakeMinor,
    durationSec: input.durationSec,
    accountId: input.accountId,
    ...(currency.success && currency.data !== undefined ? { currency: currency.data } : {}),
  });
}
