"use client";

import { cfdProfitMinor } from "@asm/contracts";
import { memo, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@asm/client-core";
import { AssetIcon } from "./AssetIcon";
import type { CfdOpenPosition } from "./CfdPositionStrip";

type Tab = "open" | "closed";

interface CfdClosedTrade {
  id: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stake: number;
  leverage?: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number;
  closeReason: string | null;
  closedAt: string | null;
}


const OpenRow = memo(function OpenRow({
  trade,
  asset,
  currency,
  onClose,
}: {
  trade: CfdOpenPosition;
  asset: PlatformAsset | undefined;
  currency: string;
  onClose: (tradeId: string) => void;
}) {
  const price = useQuote(trade.symbol)?.price ?? null;
  const isLong = trade.direction === "UP";
  const pnl = price !== null ? cfdProfitMinor(trade.direction, trade.entryPrice, price, trade.stake, trade.leverage ?? 1) : null;
  const pnlPct = price !== null && trade.entryPrice > 0
    ? ((isLong ? price - trade.entryPrice : trade.entryPrice - price) / trade.entryPrice) * 100
    : null;

  const plText = pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${formatMinor(pnl, currency)}`;
  const pctText = pnlPct !== null ? `(${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : "";
  const plClass = pnl === null || pnl === 0 ? "text-ink-2" : pnl > 0 ? "text-up" : "text-down";
  const dirColor = isLong ? "text-up" : "text-down";
  const pair = asset ? splitAssetName(asset.displayName).pair : trade.symbol;
  const precision = asset?.precision ?? 5;
  const [closing, setClosing] = useState(false);

  async function handleClose(): Promise<void> {
    setClosing(true);
    try {
      const res = await fetch(`/api/cfd/trades/${trade.id}/close`, { method: "POST" });
      if (res.ok) onClose(trade.id);
    } finally {
      setClosing(false);
    }
  }

  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-rule px-3.5 py-2.5">
      <span
        aria-label={isLong ? "Long" : "Short"}
        className={`dir-mark row-span-3 mt-[3px] ${dirColor}`}
      />
      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <AssetIcon symbol={trade.symbol} size="sm" />
        {pair}
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dirColor}`}>
          {isLong ? "LONG" : "SHORT"}
        </span>
      </span>
      <span className={`row-span-2 grid justify-items-end gap-0.5 self-center ${plClass}`}>
        <span className="text-sm font-extrabold tabular-nums">{plText}</span>
        <span className="text-[10px] tabular-nums">{pctText}</span>
      </span>
      <span className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>Entry {trade.entryPrice.toFixed(precision)}</span>
        {price !== null && <span>→ {price.toFixed(precision)}</span>}
        <span>· {formatMinor(trade.stake, currency)}</span>
      </span>
      <div className="col-start-2 col-end-4 flex items-center gap-2 pt-1">
        {trade.stopLoss !== null && (
          <span className="text-[10px] text-down">SL {trade.stopLoss}%</span>
        )}
        {trade.takeProfit !== null && (
          <span className="text-[10px] text-up">TP {trade.takeProfit}%</span>
        )}
        <button
          type="button"
          disabled={closing}
          onClick={handleClose}
          className="ml-auto h-6 rounded bg-white/10 px-2.5 text-[10px] font-bold text-ink-2 hover:bg-down hover:text-white disabled:cursor-wait"
        >
          {closing ? "Closing…" : "Close"}
        </button>
      </div>
    </li>
  );
});

function ClosedRow({
  trade,
  asset,
  currency,
}: {
  trade: CfdClosedTrade;
  asset: PlatformAsset | undefined;
  currency: string;
}) {
  const isLong = trade.direction === "UP";
  const dirColor = isLong ? "text-up" : "text-down";
  const pair = asset ? splitAssetName(asset.displayName).pair : trade.symbol;
  const precision = asset?.precision ?? 5;
  const plText = `${trade.pnl >= 0 ? "+" : ""}${formatMinor(trade.pnl, currency)}`;
  const plClass = trade.pnl === 0 ? "text-ink-2" : trade.pnl > 0 ? "text-up" : "text-down";
  const reason = trade.closeReason?.replace(/_/g, " ").toLowerCase() ?? "closed";

  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-rule px-3.5 py-2.5 opacity-75">
      <span className={`dir-mark row-span-2 mt-[3px] ${dirColor}`} />
      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <AssetIcon symbol={trade.symbol} size="sm" />
        {pair}
        <span className={`text-[10px] font-bold uppercase tracking-wider ${dirColor}`}>
          {isLong ? "LONG" : "SHORT"}
        </span>
      </span>
      <span className={`row-span-2 self-center text-sm font-extrabold tabular-nums ${plClass}`}>
        {plText}
      </span>
      <span className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>{trade.entryPrice.toFixed(precision)}</span>
        {trade.exitPrice !== null && <span>→ {trade.exitPrice.toFixed(precision)}</span>}
        <span>· {formatMinor(trade.stake, currency)}</span>
        <span className="capitalize">· {reason}</span>
      </span>
    </li>
  );
}

export function CfdTradesPanel({
  openPositions,
  closedTrades,
  currency,
  assets,
  onClose,
}: {
  openPositions: readonly CfdOpenPosition[];
  closedTrades: readonly CfdClosedTrade[];
  currency: string;
  assets: PlatformAsset[];
  onClose: (tradeId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("open");

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex border-b border-rule px-3">
        {(["open", "closed"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`h-10 px-3 text-xs font-bold uppercase tracking-wider transition-colors ${
              tab === t ? "border-b-2 border-brand text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t === "open" ? `Positions (${openPositions.length})` : "History"}
          </button>
        ))}
      </div>
      <ul className="overflow-y-auto">
        {tab === "open"
          ? openPositions.length === 0
            ? (
                <li className="px-4 py-8 text-center text-xs text-ink-3">
                  No open positions
                </li>
              )
            : openPositions.map((p) => (
                <OpenRow
                  key={p.id}
                  trade={p}
                  asset={assets.find((a) => a.symbol === p.symbol)}
                  currency={currency}
                  onClose={onClose}
                />
              ))
          : closedTrades.length === 0
            ? (
                <li className="px-4 py-8 text-center text-xs text-ink-3">
                  No trade history
                </li>
              )
            : closedTrades.map((t) => (
                <ClosedRow
                  key={t.id}
                  trade={t}
                  asset={assets.find((a) => a.symbol === t.symbol)}
                  currency={currency}
                />
              ))}
      </ul>
    </div>
  );
}
