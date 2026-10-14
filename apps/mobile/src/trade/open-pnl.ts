import { grossReturnMinor, profitForStake, type openSide } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";

export interface OpenPnl {
  sign: "+" | "−";
  amountMinor: number;
  tone: "up" | "down";
}

/**
 * What an open trade would pay if it closed now, given which side of the entry the price is on (`openSide`).
 * A win shows the gross return (stake + profit), a loss the stake, exactly as the closed row will. Null while
 * there is no price yet or it sits exactly on the entry: no result to show, so no red loss.
 */
export function openPnl(
  trade: Pick<TradeView, "stake" | "payoutPct">,
  side: ReturnType<typeof openSide>,
): OpenPnl | null {
  if (side === "winning") {
    const profit = profitForStake(trade.stake, trade.payoutPct) ?? 0;
    return { sign: "+", amountMinor: grossReturnMinor(trade.stake, profit), tone: "up" };
  }
  if (side === "losing") return { sign: "−", amountMinor: trade.stake, tone: "down" };
  return null;
}
