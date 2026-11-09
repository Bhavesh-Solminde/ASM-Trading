import type { TradeView } from "@asm/contracts";

/**
 * The pure parts of the History model, shared by the web and the app: the row shapes the server hands over,
 * status tone, filtering and day grouping. Wording (status labels, English day names) is NOT localised here:
 * the web keeps its English copy, and the app translates through its own i18n keys.
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

export function parseFilter(value: string | null | undefined, allowed: readonly HistoryFilter[]): HistoryFilter {
  return allowed.find((f) => f === value) ?? "all";
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

/** Money that never moved (or came straight back) reads muted and struck through. */
export function paymentMovedNoMoney(status: string): boolean {
  return status === "REJECTED" || status === "EXPIRED" || status === "CANCELLED_BY_USER" || status === "AWAITING_PAYMENT";
}

/** Splits "NIFTY 50 (India)" into its pair and market qualifier. */
export function splitAssetName(displayName: string): { pair: string; market: string } {
  const match = /^(.*?)\s*\((.+)\)$/.exec(displayName);
  return match ? { pair: match[1]!, market: match[2]! } : { pair: displayName, market: "" };
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

/**
 * Short reference shown to the user, e.g. "WD-8F3K2Q1A". It keeps the first 8
 * characters of the id, the same slice the old history table showed, so a
 * reference a customer already quoted still matches.
 */
export function referenceFor(row: Pick<PaymentRow, "kind" | "id">): string {
  return `${row.kind === "deposit" ? "DP" : "WD"}-${row.id.slice(0, 8).toUpperCase()}`;
}
