"use client";

import type { TradeView } from "@asm/contracts";
import { formatMinor } from "@/lib/format-money";

function statusColor(status: TradeView["status"]): string {
  if (status === "WON") return "var(--color-up)";
  if (status === "LOST") return "var(--color-down)";
  return "var(--color-ink-2)";
}

function outcomeLabel(trade: TradeView, currency: string): string {
  if (trade.status === "OPEN") return "Open";
  if (trade.status === "REFUNDED") return "Refunded";
  const sign = trade.pnl >= 0 ? "+" : "−";
  return `${sign}${formatMinor(Math.abs(trade.pnl), currency)}`;
}

export function TradesPanel({
  trades,
  currency,
  precision,
}: {
  trades: TradeView[];
  currency: string;
  precision: number;
}) {
  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
        <p className="text-xs text-[var(--color-ink-2)]">No trades yet. Place one using the ticket above.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-3">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
        Trades
      </p>
      <ul className="flex flex-col divide-y divide-[var(--color-edge)]">
        {trades.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-xs">
            <div className="flex flex-col">
              <span className="font-semibold">{t.symbol}</span>
              <span className="text-[var(--color-ink-2)]">
                {t.direction === "UP" ? "↑" : "↓"} {formatMinor(t.stake, currency)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-semibold tabular-nums" style={{ color: statusColor(t.status) }}>
                {outcomeLabel(t, currency)}
              </span>
              <span className="tabular-nums text-[var(--color-ink-2)]">{t.entryPrice.toFixed(precision)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
