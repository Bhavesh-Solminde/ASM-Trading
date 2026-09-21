import type { TradeView } from "@asm/contracts";

/**
 * The gross amount a winning position returns: the stake plus its profit. A
 * win pays the stake back *and* the profit, so the amount surfaced to the
 * trader is the total received (e.g. a $100 stake at 100% payout shows
 * +$200), not just the net profit.
 */
export function grossReturnMinor(stakeMinor: number, profitMinor: number): number {
  return stakeMinor + profitMinor;
}

export interface ClosedDisplay {
  /** Leading sign; empty for a refund. */
  readonly sign: "+" | "−" | "";
  /** Minor units to format after the sign. */
  readonly amountMinor: number;
  /** Colour class for the amount. */
  readonly className: string;
}

/**
 * How a settled trade's amount reads in the trades list. A win shows its
 * gross return (stake + profit); a loss shows the stake lost; a refund shows
 * a signless zero. `pnl` is the stored net (profit for a win, −stake for a
 * loss), so gross = stake + pnl for a win.
 */
export function closedRowDisplay(trade: Pick<TradeView, "status" | "stake" | "pnl">): ClosedDisplay {
  if (trade.status === "REFUNDED") {
    return { sign: "", amountMinor: 0, className: "text-ink-2" };
  }
  if (trade.status === "WON") {
    return { sign: "+", amountMinor: grossReturnMinor(trade.stake, trade.pnl), className: "text-up" };
  }
  // LOST: pnl is negative (−stake); show the magnitude lost.
  return { sign: "−", amountMinor: Math.abs(trade.pnl), className: "text-ink-3" };
}
