"use client";

import { memo, useState, type ReactNode } from "react";
import type { TradeView } from "@asm/contracts";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@/lib/format-money";
import { clockTime, countdown } from "@/lib/format-time";
import { useNowSec } from "@/lib/use-now";
import { closedRowDisplay, grossReturnMinor } from "./pnl-display";

type Tab = "open" | "closed";

const STATUS_CHIP: Record<TradeView["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-tile text-ink" },
  WON: { label: "Won", className: "bg-up text-up-ink" },
  LOST: { label: "Lost", className: "text-down shadow-[inset_0_0_0_1px_var(--color-down)]" },
  REFUNDED: { label: "Refund", className: "bg-tile text-ink-2" },
};

function RowShell({
  trade,
  asset,
  currency,
  time,
  pnl,
  pnlClass,
  children,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
  time: ReactNode;
  pnl: string;
  pnlClass: string;
  children?: ReactNode;
}) {
  const precision = asset?.precision ?? 5;
  const chip = STATUS_CHIP[trade.status];
  const up = trade.direction === "UP";

  return (
    <li className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-rule px-3.5 py-2.5">
      <span
        aria-label={up ? "Buy" : "Sell"}
        className={`dir-mark row-span-3 mt-[3px] ${up ? "text-up" : "text-down"}`}
        data-dir={up ? "up" : "down"}
      />
      <span className="font-bold tracking-[0.03em]">{asset ? splitAssetName(asset.displayName).pair : trade.symbol}</span>
      {time}
      <span className="text-xs text-ink-2">{formatMinor(trade.stake, currency)}</span>
      <span className={`justify-self-end font-bold ${pnlClass}`}>{pnl}</span>
      <span className="text-[11px] text-ink-3">
        {trade.entryPrice.toFixed(precision)}
        {trade.exitPrice !== null ? ` → ${trade.exitPrice.toFixed(precision)}` : ""}
      </span>
      <span
        className={`justify-self-end rounded-[2px] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.1em] ${chip.className}`}
      >
        {chip.label}
      </span>
      {children}
    </li>
  );
}

/** Subscribes to its own symbol's price and the clock; settled rows never re-render. */
const OpenTradeRow = memo(function OpenTradeRow({
  trade,
  asset,
  currency,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
}) {
  const now = useNowSec();
  const price = useQuote(trade.symbol)?.price ?? null;
  const winning = price !== null && (trade.direction === "UP" ? price > trade.entryPrice : price < trade.entryPrice);
  const losing = price !== null && (trade.direction === "UP" ? price < trade.entryPrice : price > trade.entryPrice);
  const winProfit = Math.floor((trade.stake * trade.payoutPct) / 100);
  const progress =
    now === null ? 0 : Math.min(1, Math.max(0, (now - trade.entryTs) / (trade.expiryTs - trade.entryTs)));

  return (
    <RowShell
      trade={trade}
      asset={asset}
      currency={currency}
      time={<span className="led justify-self-end text-[13px] text-ink">{now === null ? "" : countdown(trade.expiryTs - now)}</span>}
      pnl={winning ? `+${formatMinor(grossReturnMinor(trade.stake, winProfit), currency)}` : `−${formatMinor(trade.stake, currency)}`}
      pnlClass={winning ? "text-up" : losing ? "text-down" : "text-ink-2"}
    >
      <span aria-hidden className="absolute -bottom-px left-0 h-0.5 bg-up" style={{ width: `${progress * 100}%` }} />
    </RowShell>
  );
});

const ClosedTradeRow = memo(function ClosedTradeRow({
  trade,
  asset,
  currency,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
}) {
  const display = closedRowDisplay(trade);
  return (
    <RowShell
      trade={trade}
      asset={asset}
      currency={currency}
      time={<span className="led justify-self-end text-[13px] text-ink-2">{clockTime(trade.expiryTs)}</span>}
      pnl={`${display.sign}${formatMinor(display.amountMinor, currency)}`}
      pnlClass={display.className}
    />
  );
});

export function TradesPanel({
  trades,
  currency,
  assets,
}: {
  trades: TradeView[];
  currency: string;
  assets: PlatformAsset[];
}) {
  const [tab, setTab] = useState<Tab>("open");
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status !== "OPEN");
  const shown = tab === "open" ? open : closed;
  const Row = tab === "open" ? OpenTradeRow : ClosedTradeRow;

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div role="tablist" className="flex border-b border-rule px-3">
        {(["open", "closed"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`mr-2 flex items-center gap-2 border-b-2 px-2 pb-2.5 pt-3 text-[11px] font-bold uppercase tracking-[0.1em] ${
              tab === t ? "border-up text-ink" : "border-transparent text-ink-3"
            }`}
          >
            {t}
            <span className="inline-grid h-[18px] min-w-5 place-items-center rounded-[2px] bg-tile px-[5px] text-[11px] text-ink-2">
              {t === "open" ? open.length : closed.length}
            </span>
          </button>
        ))}
      </div>

      <ul aria-live="polite" className="m-0 list-none overflow-auto py-1">
        {shown.length === 0 ? (
          <li className="grid gap-1.5 px-[18px] py-7 text-center text-ink-3">
            <strong className="font-semibold text-ink-2">No {tab} trades on this account</strong>
            <span>Set a time and investment above, then choose Up or Down.</span>
          </li>
        ) : (
          shown.map((trade) => (
            <Row
              key={trade.id}
              trade={trade}
              currency={currency}
              asset={assets.find((a) => a.symbol === trade.symbol)}
            />
          ))
        )}
      </ul>
    </div>
  );
}
