import type { TradeView } from "@asm/contracts";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@/lib/format-money";
import { closedRowDisplay, settledAmountText } from "@/components/trade/pnl-display";

/**
 * Pure model behind the History list and its detail sheet: the row shapes the
 * server hands over, status wording/tone, filtering and day grouping. Kept free
 * of React so the rules are unit-tested.
 */

export type HistoryFilter = "all" | "trades" | "deposits" | "withdrawals";
export type Tone = "up" | "down" | "caution" | "neutral";

/** A deposit or withdrawal, serialisable from a server component. */
export interface PaymentRow {
  /** Deep-link key: `d:<depositId>` or `w:<withdrawalId>`. */
  key: string;
  id: string;
  kind: "deposit" | "withdrawal";
  /** ISO timestamp the request was created. */
  createdAt: string;
  /** ISO timestamp of the last status change (deposits only; withdrawals have none). */
  updatedAt: string | null;
  /** Raw DepositStatus / WithdrawalStatus value. */
  status: string;
  /** "UPI", "USDT (TRC-20)", "Bank transfer"… */
  methodLabel: string;
  /** Always positive; the sign comes from `kind`. */
  amountMinor: number;
  currency: string;
  /** Withdrawals: masked payout destination. */
  destination: string | null;
  /** Deposits awaiting payment: when the checkout window closes. */
  expiresAt: string | null;
  /** Held withdrawals: when the hold lifts / when cancelling stops being possible. */
  holdUntil: string | null;
  cancelableUntil: string | null;
}

export type HistoryItem =
  | { kind: "trade"; key: string; atMs: number; trade: TradeView; currency: string; pair: string }
  | { kind: "deposit" | "withdrawal"; key: string; atMs: number; payment: PaymentRow };

export const FILTER_LABEL: Record<HistoryFilter, string> = {
  all: "All",
  trades: "Trades",
  deposits: "Deposits",
  withdrawals: "Withdrawals",
};

export function parseFilter(value: string | null | undefined, allowed: readonly HistoryFilter[]): HistoryFilter {
  return allowed.find((f) => f === value) ?? "all";
}

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

/**
 * What a status means to the user, not its raw value: done and good is green,
 * still moving is amber, ended badly is red, anything else is quiet.
 */
export function statusTone(status: string): Tone {
  switch (status) {
    case "COMPLETED":
    case "PAID":
    case "WON":
      return "up";
    case "AWAITING_PAYMENT":
    case "PENDING_CONFIRMATION":
    case "REQUESTED":
    case "HELD":
    case "APPROVED":
      return "caution";
    case "REJECTED":
    case "EXPIRED":
    case "CANCELLED_BY_USER":
    case "LOST":
      return "down";
    default:
      return "neutral";
  }
}

export const TONE_PILL: Record<Tone, string> = {
  up: "bg-up/12 text-up",
  down: "bg-down/12 text-down",
  caution: "bg-caution/12 text-caution",
  neutral: "bg-tile text-ink-2",
};

/** Money that never moved (or came straight back) reads muted and struck through. */
export function paymentMovedNoMoney(status: string): boolean {
  return status === "REJECTED" || status === "EXPIRED" || status === "CANCELLED_BY_USER" || status === "AWAITING_PAYMENT";
}

export function paymentAmountText(row: Pick<PaymentRow, "kind" | "amountMinor" | "currency">): string {
  return `${row.kind === "deposit" ? "+" : "−"}${formatMinor(row.amountMinor, row.currency)}`;
}

export function paymentTitle(row: Pick<PaymentRow, "kind">): string {
  return row.kind === "deposit" ? "Deposit" : "Withdrawal";
}

export function tradeTitle(trade: Pick<TradeView, "direction">, pair: string): string {
  return `${pair} · ${trade.direction === "UP" ? "Buy" : "Sell"}`;
}

export function tradePairName(trade: Pick<TradeView, "symbol">, displayName: string | undefined): string {
  return displayName ? splitAssetName(displayName).pair : trade.symbol;
}

/** "30s", "1m", "5m", "1h" from an open/close pair of epoch seconds. */
export function durationLabel(entryTs: number, expiryTs: number): string {
  const sec = Math.max(0, Math.round(expiryTs - entryTs));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return sec % 60 === 0 ? `${sec / 60}m` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return sec % 3600 === 0 ? `${sec / 3600}h` : `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

export interface TradeAmount {
  text: string;
  tone: Tone;
}

/** Same figures as the chart's result card: a win reads stake + profit = total. */
export function tradeAmount(trade: TradeView, currency: string): TradeAmount {
  const { sign } = closedRowDisplay(trade);
  const tone: Tone = sign === "+" ? "up" : sign === "−" ? "down" : "neutral";
  return { text: settledAmountText(trade, currency), tone };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "HH:MM". */
export function timeOfDay(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Local "Oct 10" (with the year when it isn't this year). */
export function shortDate(d: Date, now: Date): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function dayLabel(d: Date, now: Date): string {
  if (dayKey(d) === dayKey(now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return shortDate(d, now);
}

export function itemMatchesFilter(item: HistoryItem, filter: HistoryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "trades":
      return item.kind === "trade";
    case "deposits":
      return item.kind === "deposit";
    case "withdrawals":
      return item.kind === "withdrawal";
  }
}

export interface DayGroup {
  key: string;
  label: string;
  items: HistoryItem[];
}

/** Newest first, grouped by local calendar day. */
export function groupByDay(items: readonly HistoryItem[], now: Date): DayGroup[] {
  const sorted = [...items].sort((a, b) => b.atMs - a.atMs);
  const groups: DayGroup[] = [];
  for (const item of sorted) {
    const d = new Date(item.atMs);
    const key = dayKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(d, now), items: [item] });
  }
  return groups;
}

export function paymentItem(row: PaymentRow): HistoryItem {
  return { kind: row.kind, key: row.key, atMs: new Date(row.createdAt).getTime(), payment: row };
}

/** What the empty state says for each filter. */
export const EMPTY_COPY: Record<HistoryFilter, { title: string; body: string }> = {
  all: { title: "Nothing here yet", body: "Your trades, deposits and withdrawals will show up here." },
  trades: { title: "No closed trades", body: "Trades appear here once they finish. Place one from the Trade screen." },
  deposits: { title: "No deposits yet", body: "Add funds to start trading with real money." },
  withdrawals: { title: "No withdrawals yet", body: "Requests you make will show up here with their progress." },
};
