"use client";

import { memo, useState, type ReactNode } from "react";
import type { TradeView } from "@asm/contracts";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import {
  cfdOpenPnl,
  clockTime,
  closedRowDisplay,
  countdown,
  formatMinor,
  grossReturnMinor,
  openSide,
  settledAmountText,
} from "@asm/client-core";
import { useNowSec } from "@/lib/use-now";
import { AssetIcon } from "./AssetIcon";

type Tab = "open" | "closed";

const STATUS_CHIP: Record<TradeView["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-tile text-ink" },
  WON: { label: "Won", className: "bg-up text-up-ink" },
  LOST: { label: "Lost", className: "text-down shadow-[inset_0_0_0_1px_var(--color-down)]" },
  REFUNDED: { label: "Refund", className: "bg-tile text-ink-2" },
  CLOSED: { label: "Closed", className: "bg-tile text-ink" },
};

function RowShell({
  trade,
  asset,
  currency,
  time,
  pnl,
  pnlClass,
  chipOverride,
  children,
  onSelectTrade, selectedTradeId,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
  time: ReactNode;
  pnl: string;
  pnlClass: string;
  chipOverride?: { label: string; className: string };
  children?: ReactNode;
  onSelectTrade?: ((trade: TradeView) => void) | undefined; selectedTradeId?: string | undefined;
}) {
  const precision = asset?.precision ?? 5;
  const chip = chipOverride ?? STATUS_CHIP[trade.status];
  const up = trade.direction === "UP";

  return (
    <li className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-rule px-3.5 py-2.5">
      <span
        aria-label={up ? "Buy" : "Sell"}
        className={`dir-mark row-span-3 mt-[3px] ${up ? "text-up" : "text-down"}`}
        data-dir={up ? "up" : "down"}
      />
      <div className="flex items-center gap-1.5 min-w-0">
        <AssetIcon symbol={trade.symbol} size="sm" />
        <span className="font-bold tracking-[0.03em] truncate">{asset ? splitAssetName(asset.displayName).pair : trade.symbol}</span>
      </div>
      {time}
      <span className="text-xs tabular-nums text-ink-2">{formatMinor(trade.stake, currency)}</span>
      <span className={`justify-self-end font-bold tabular-nums ${pnlClass}`}>{pnl}</span>
      <span className="text-[11px] tabular-nums text-ink-3">
        {trade.entryPrice.toFixed(precision)}
        {trade.exitPrice !== null ? ` → ${trade.exitPrice.toFixed(precision)}` : ""}
      </span>
      <span
        className={`justify-self-end rounded-[2px] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.1em] ${chip.className}`}
      >
        {chip.label}
      </span>
      {trade.durationSec != null && <span className="col-span-3 text-[11px] text-ink-3">Spread fee: {formatMinor(trade.spreadFee ?? 0, currency)}</span>}
      {children}
      {onSelectTrade && trade.durationSec != null && <button type="button" aria-label={`Show ${trade.direction === "UP" ? "Buy" : "Sell"} trade ${trade.id} SL/TP`} aria-pressed={selectedTradeId === trade.id} onClick={() => onSelectTrade(trade)} className="absolute inset-0 rounded focus-visible:outline-2 focus-visible:outline-brand hover:bg-brand/5" />}
    </li>
  );
}

/** Subscribes to its own symbol's price and the clock; settled rows never re-render. */
const OpenTradeRow = memo(function OpenTradeRow({
  trade,
  asset,
  currency,
  onSelectTrade, selectedTradeId,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
  onSelectTrade?: ((trade: TradeView) => void) | undefined; selectedTradeId?: string | undefined;
}) {
  const now = useNowSec();
  const price = useQuote(trade.symbol)?.price ?? null;
  const cfdPnl = trade.durationSec != null ? cfdOpenPnl(trade, price) : null;
  const cfdText = cfdPnl === null ? "—" : `${cfdPnl > 0 ? "+" : cfdPnl < 0 ? "−" : ""}${formatMinor(Math.abs(cfdPnl), currency)}`;
  const side = openSide(trade.direction, trade.entryPrice, price);
  const winning = side === "winning";
  const losing = side === "losing";
  const winProfit = Math.floor((trade.stake * trade.payoutPct) / 100);
  const progress =
    now === null ? 0 : Math.min(1, Math.max(0, (now - trade.entryTs) / (trade.expiryTs - trade.entryTs)));
  const expired = now !== null && now >= trade.expiryTs;

  // Only the engine can confirm a settlement and its actual outcome.
  const pnlDisplay = expired ? "—" : trade.durationSec != null ? cfdText : winning
    ? `+${formatMinor(grossReturnMinor(trade.stake, winProfit), currency)}`
    : `−${formatMinor(trade.stake, currency)}`;
  const pnlClass = expired ? "text-ink-2" : trade.durationSec != null ? (cfdPnl === null || cfdPnl === 0 ? "text-ink-2" : cfdPnl > 0 ? "text-up" : "text-down") : winning ? "text-up" : losing ? "text-down" : "text-ink-2";
  const chipOverride = expired
    ? { label: "Settling", className: "bg-tile text-ink-2" }
    : undefined;

  return (
    <RowShell
      onSelectTrade={onSelectTrade} selectedTradeId={selectedTradeId}
      trade={trade}
      asset={asset}
      currency={currency}
      time={
        <span className="led justify-self-end text-[13px] text-ink">
          {now === null ? "" : expired ? "0s" : countdown(trade.expiryTs - now)}
        </span>
      }
      pnl={pnlDisplay}
      pnlClass={pnlClass}
      {...(chipOverride ? { chipOverride } : {})}
    >
      <span aria-hidden className="absolute -bottom-px left-0 h-0.5 bg-up" style={{ width: `${progress * 100}%` }} />
    </RowShell>
  );
});

const ClosedTradeRow = memo(function ClosedTradeRow({
  trade,
  asset,
  currency,
  onSelectTrade, selectedTradeId,
}: {
  trade: TradeView;
  asset: PlatformAsset | undefined;
  currency: string;
  onSelectTrade?: ((trade: TradeView) => void) | undefined; selectedTradeId?: string | undefined;
}) {
  const display = closedRowDisplay(trade);
  return (
    <RowShell
      onSelectTrade={onSelectTrade} selectedTradeId={selectedTradeId}
      trade={trade}
      asset={asset}
      currency={currency}
      time={<span className="led justify-self-end text-[13px] text-ink-2">{clockTime(trade.expiryTs)}</span>}
      pnl={settledAmountText(trade, currency)}
      pnlClass={display.className}
    />
  );
});

export function TradesPanel({
  trades,
  currency,
  assets,
  onSelectTrade, selectedTradeId,
}: {
  trades: TradeView[];
  currency: string;
  assets: PlatformAsset[];
  onSelectTrade?: ((trade: TradeView) => void) | undefined; selectedTradeId?: string | undefined;
}) {
  const [tab, setTab] = useState<Tab>("open");
  const open = trades.filter((t) => t.status === "OPEN");
  const closed = trades.filter((t) => t.status !== "OPEN");
  const shown = tab === "open" ? open : closed;
  const Row = tab === "open" ? OpenTradeRow : ClosedTradeRow;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
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

      <ul aria-live="polite" className="m-0 list-none overflow-auto overscroll-contain py-1">
        {shown.length === 0 ? (
          <li className="grid gap-1.5 px-[18px] py-7 text-center text-ink-3">
            <strong className="font-semibold text-ink-2">No {tab} trades on this account</strong>
            <span>Set a time and investment, then choose Buy or Sell.</span>
          </li>
        ) : (
          shown.map((trade) => (
            <Row
              key={trade.id}
              onSelectTrade={onSelectTrade} selectedTradeId={selectedTradeId}
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
