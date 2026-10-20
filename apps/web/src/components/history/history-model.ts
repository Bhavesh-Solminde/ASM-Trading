import type { TradeView } from "@asm/contracts";
import {
  closedRowDisplay,
  formatMinor,
  type HistoryFilter,
  type PaymentRow,
  type Tone,
} from "@asm/client-core";

/**
 * Web side of the History model. The pure rules (row shapes, tone, filtering, day grouping) live in
 * @asm/client-core, shared with the Android app, and are re-exported here; this file keeps the web-only
 * parts: English copy and the Tailwind classes.
 */

export {
  dayLabel,
  durationLabel,
  groupByDay,
  itemMatchesFilter,
  parseFilter,
  paymentItem,
  paymentMovedNoMoney,
  shortDate,
  statusTone,
  tradePairName,
  type DayGroup,
  type HistoryFilter,
  type HistoryItem,
  type PaymentRow,
  type Tone,
} from "@asm/client-core";

export const FILTER_LABEL: Record<HistoryFilter, string> = {
  all: "All",
  trades: "Trades",
  deposits: "Deposits",
  withdrawals: "Withdrawals",
};

const PAYMENT_LABEL: Record<string, string> = {
  // Deposit
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_CONFIRMATION: "Processing",
  COMPLETED: "Credited",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  // Withdrawal
  REQUESTED: "In review",
  HELD: "On hold",
  APPROVED: "Approved",
  PAID: "Paid",
  CANCELLED_BY_USER: "Cancelled",
  // Trade
  WON: "Won",
  LOST: "Lost",
  REFUNDED: "Refunded",
};

export function statusLabel(status: string): string {
  return PAYMENT_LABEL[status] ?? status;
}

export const TONE_PILL: Record<Tone, string> = {
  up: "bg-up/12 text-up",
  down: "bg-down/12 text-down",
  caution: "bg-caution/12 text-caution",
  neutral: "bg-tile text-ink-2",
};

export function paymentAmountText(row: Pick<PaymentRow, "kind" | "amountMinor" | "currency">): string {
  return `${row.kind === "deposit" ? "+" : "−"}${formatMinor(row.amountMinor, row.currency)}`;
}

export function paymentTitle(row: Pick<PaymentRow, "kind">): string {
  return row.kind === "deposit" ? "Deposit" : "Withdrawal";
}

export function tradeTitle(trade: Pick<TradeView, "direction">, pair: string): string {
  return `${pair} · ${trade.direction === "UP" ? "Buy" : "Sell"}`;
}

export interface TradeAmount {
  text: string;
  tone: Tone;
}

/** Same figures as the trade screen's Closed tab: a win shows stake + profit. */
export function tradeAmount(trade: TradeView, currency: string): TradeAmount {
  const d = closedRowDisplay(trade);
  const tone: Tone = trade.status === "WON" ? "up" : trade.status === "LOST" ? "down" : "neutral";
  return { text: `${d.sign}${formatMinor(d.amountMinor, currency)}`, tone };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "HH:MM". */
export function timeOfDay(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What the empty state says for each filter. */
export const EMPTY_COPY: Record<HistoryFilter, { title: string; body: string }> = {
  all: { title: "Nothing here yet", body: "Your trades, deposits and withdrawals will show up here." },
  trades: { title: "No closed trades", body: "Trades appear here once they finish. Place one from the Trade screen." },
  deposits: { title: "No deposits yet", body: "Add funds to start trading with real money." },
  withdrawals: { title: "No withdrawals yet", body: "Requests you make will show up here with their progress." },
};
