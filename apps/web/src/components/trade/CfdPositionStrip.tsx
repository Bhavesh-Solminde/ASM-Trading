"use client";

import { cfdProfitMinor } from "@asm/contracts";
import { memo, useMemo, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@asm/client-core";

export interface CfdOpenPosition {
  id: string;
  accountId: string;
  symbol: string;
  direction: "UP" | "DOWN";
  stake: number;
  leverage?: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  createdAt: string;
  durationSec: number | null;
}


const CfdStripBody = memo(function CfdStripBody({
  position,
  more,
  asset,
  currency,
  onOpen,
  onClose,
}: {
  position: CfdOpenPosition;
  more: number;
  asset: PlatformAsset | undefined;
  currency: string;
  onOpen: () => void;
  onClose: (tradeId: string) => void;
}) {
  const price = useQuote(position.symbol)?.price ?? null;
  const isLong = position.direction === "UP";
  const pnl = price !== null ? cfdProfitMinor(position.direction, position.entryPrice, price, position.stake, position.leverage ?? 1) : null;
  const pnlPct = price !== null && position.entryPrice > 0
    ? ((isLong ? price - position.entryPrice : position.entryPrice - price) / position.entryPrice) * 100
    : null;

  const winning = pnl !== null && pnl > 0;
  const losing = pnl !== null && pnl < 0;
  const plText = pnl === null
    ? "—"
    : `${pnl >= 0 ? "+" : ""}${formatMinor(pnl, currency)}`;
  const pctText = pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "";
  const plClass = pnl === null || pnl === 0 ? "text-ink-2" : winning ? "text-up" : "text-down";
  const dirColor = isLong ? "text-up" : "text-down";
  const pair = asset ? splitAssetName(asset.displayName).pair : position.symbol;
  const [closing, setClosing] = useState(false);

  async function handleClose(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    setClosing(true);
    try {
      const res = await fetch(`/api/cfd/trades/${position.id}/close`, { method: "POST" });
      if (res.ok) onClose(position.id);
    } finally {
      setClosing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${isLong ? "Long" : "Short"} ${pair}, ${formatMinor(position.stake, currency)}${
        more > 0 ? `, and ${more} more` : ""
      }. Show positions`}
      className="pointer-events-auto flex h-14 w-full items-center gap-2.5 rounded-[14px] bg-tile pl-3 pr-2 text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.9)] transition-colors active:bg-tile-hi"
    >
      <span className={`text-xs font-extrabold tracking-[0.06em] ${dirColor}`}>
        {isLong ? "LONG" : "SHORT"}
      </span>
      <span className="grid min-w-0 gap-px">
        <span className="truncate text-[12px] font-semibold text-ink">
          {pair} · {formatMinor(position.stake, currency)}
        </span>
        {more > 0 && (
          <span className="text-[10px] text-ink-3">+{more} more</span>
        )}
      </span>
      <span className="ml-auto grid flex-none justify-items-end gap-px">
        <span className={`text-[15px] font-extrabold tabular-nums leading-tight ${plClass}`}>
          {plText}
        </span>
        <span className={`text-[10px] tabular-nums leading-tight ${plClass}`}>
          {pctText}
        </span>
      </span>
      <button
        type="button"
        disabled={closing}
        onClick={handleClose}
        aria-label="Close position"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-white/10 text-ink-2 hover:bg-down hover:text-white"
      >
        <Icon name="close" className="size-3.5" strokeWidth={2.5} />
      </button>
    </button>
  );
});

export function CfdPositionStrip({
  positions,
  assets,
  currency,
  onOpen,
  onClose,
  className = "",
}: {
  positions: readonly CfdOpenPosition[];
  assets: PlatformAsset[];
  currency: string;
  onOpen: () => void;
  onClose: (tradeId: string) => void;
  className?: string;
}) {
  const sorted = useMemo(
    () =>
      [...positions]
        .filter((p) => p.durationSec !== null)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [positions],
  );
  if (sorted.length === 0) return null;
  const first = sorted[0]!;

  return (
    <div className={className}>
      <CfdStripBody
        key={first.id}
        position={first}
        more={sorted.length - 1}
        asset={assets.find((a) => a.symbol === first.symbol)}
        currency={currency}
        onOpen={onOpen}
        onClose={onClose}
      />
    </div>
  );
}
