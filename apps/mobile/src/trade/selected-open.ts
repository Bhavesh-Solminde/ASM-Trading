import type { TradeView } from "@asm/contracts";
export function selectedOpen(trades: readonly TradeView[], selectedId?: string | null) {
  const open = trades.filter(trade => trade.status === "OPEN").sort((a, b) => a.expiryTs - b.expiryTs);
  return { open, selected: open.find(trade => trade.id === selectedId) ?? open[0] ?? null };
}
