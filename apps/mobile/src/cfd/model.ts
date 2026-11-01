import { cfdProfitMinor, CfdTradeViewSchema, type CfdTradeView, type TradeView } from "@asm/contracts";

export type CfdBook = Record<string, readonly CfdTradeView[]>;
export const EMPTY_CFD: readonly CfdTradeView[] = [];
/** A delayed open must never resurrect a position already closed by a socket or a refetch. */
export function mergeCfd(book: CfdBook, accountId: string, incoming: readonly CfdTradeView[], source: "fetch" | "socket" = "fetch"): CfdBook {
  const rows = new Map((book[accountId] ?? []).map(t => [t.id, t]));
  for (const t of incoming) {
    if (t.accountId !== accountId) continue;
    const old = rows.get(t.id);
    if (old?.status === "CLOSED" && (t.status === "OPEN" || source === "socket" && t.stake !== old.stake)) continue;
    rows.set(t.id, t);
  }
  const ordered = [...rows.values()].sort((a,b) => b.entryTs-a.entryTs);
  return { ...book, [accountId]: [...ordered.filter(t => t.status === "OPEN"), ...ordered.filter(t => t.status === "CLOSED").slice(0, 100)] };
}
export function parseCfd(rows: readonly unknown[]): CfdTradeView[] {
  return rows.flatMap(row => { const result = CfdTradeViewSchema.safeParse(row); return result.success ? [result.data] : []; });
}
export function cfdNet(trade: CfdTradeView, price?: number | null): number | null {
  const gross = trade.status === "CLOSED" ? trade.pnl : price != null && price > 0
    ? cfdProfitMinor(trade.direction, trade.entryPrice, price, trade.stake, trade.leverage ?? 1) : null;
  return gross === null ? null : gross - (trade.spreadFee ?? 0);
}
/** Only the chart's price/entry rendering is reused. No binary payout calculations consume this adapter. */
export function cfdChartTrade(trade: CfdTradeView): TradeView {
  return { ...trade, direction: trade.direction === "LONG" ? "UP" : "DOWN", payoutPct: 0 };
}
export function protectionPct(text: string, max: number): number | undefined | null {
  if (!text.trim()) return undefined;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= max ? value : null;
}
