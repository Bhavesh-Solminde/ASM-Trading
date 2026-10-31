import { cfdProfitMinor } from "@asm/contracts";
import type { TradeView } from "@asm/contracts";
import { formatMinor } from "../money/format-money";

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
  if (trade.status === "CLOSED") {
    return { sign: trade.pnl > 0 ? "+" : trade.pnl < 0 ? "−" : "",
      amountMinor: Math.abs(trade.pnl),
      className: trade.pnl > 0 ? "text-up" : trade.pnl < 0 ? "text-down" : "text-ink-2" };
  }
  if (trade.status === "WON") {
    return { sign: "+", amountMinor: grossReturnMinor(trade.stake, trade.pnl), className: "text-up" };
  }
  // LOST: pnl is negative (−stake); show the magnitude lost.
  return { sign: "−", amountMinor: Math.abs(trade.pnl), className: "text-ink-3" };
}

/**
 * A settled trade's result as the chart card and History show it. A win (a
 * classic WON, or a CFD closed in profit) shows the total that came back,
 * stake + profit (₹100 stake, ₹10 profit → "+₹110.00"). A loss shows only
 * what was lost ("−₹10.00"); a refund or flat close reads "₹0.00".
 */
export function settledAmountText(trade: Pick<TradeView, "status" | "stake" | "pnl">, currency: string): string {
  if (trade.status === "WON" || (trade.status === "CLOSED" && trade.pnl > 0)) {
    return `+${formatMinor(grossReturnMinor(trade.stake, trade.pnl), currency)}`;
  }
  const d = closedRowDisplay(trade);
  return `${d.sign}${formatMinor(d.amountMinor, currency)}`;
}

/**
 * Where an open trade stands against the live price: "winning" when the price
 * is on the trade's side of the entry, "losing" when it is against it, "flat"
 * when equal, null while there is no price yet. The trades list and the phone
 * position strip both read this, so they never disagree.
 */
export function openSide(
  direction: TradeView["direction"],
  entryPrice: number,
  price: number | null,
): "winning" | "losing" | "flat" | null {
  if (price === null) return null;
  if (price === entryPrice) return "flat";
  const above = price > entryPrice;
  return (direction === "UP") === above ? "winning" : "losing";
}

/**
 * Leveraged CFD gross PnL at the displayed price, capped at the stake.
 *
 * This is PURE market move only — the opening spread fee is NOT subtracted
 * here. The fee was debited from the user's wallet when the trade opened
 * (cfd-desk.ts:182), so subtracting it again on every tick would make a trade
 * that is up by less than the fee read red even while the chart is clearly
 * on the user's side. Credited balance on close is `stake + grossPnl`, which
 * matches this number exactly.
 */
export function cfdOpenPnl(trade: Pick<TradeView, "direction" | "stake" | "entryPrice" | "leverage">, price: number | null): number | null {
  if (price === null || trade.entryPrice <= 0) return null;
  return cfdProfitMinor(trade.direction, trade.entryPrice, price, trade.stake, trade.leverage ?? 1);
}
