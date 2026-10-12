"use client";

import { memo, useMemo, useState } from "react";
import type { TradeView } from "@asm/contracts";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { formatMinor } from "@/lib/format-money";
import { useNowSec } from "@/lib/use-now";
import { grossReturnMinor, openSide } from "./pnl-display";
import { RING_LENGTH, ringOffset, shortCountdown, soonestOpen } from "./position";

/**
 * Ticks on its own each second (and with its symbol's price), so the chart and
 * ticket around it never re-render for it. Keyed by trade id by the parent, so
 * the frozen-outcome state below resets when the soonest trade changes.
 */
const StripBody = memo(function StripBody({
  trade,
  more,
  asset,
  currency,
  onOpen,
}: {
  trade: TradeView;
  more: number;
  asset: PlatformAsset | undefined;
  currency: string;
  onOpen: () => void;
}) {
  const now = useNowSec();
  const price = useQuote(trade.symbol)?.price ?? null;
  const up = trade.direction === "UP";
  const side = openSide(trade.direction, trade.entryPrice, price);
  const expired = now !== null && now >= trade.expiryTs;

  // Same freeze as the trades list: at 0:00 hold the side we were showing so a
  // late tick can't flip the figure before the settlement event replaces the strip.
  const [frozen, setFrozen] = useState<typeof side | undefined>(undefined);
  if (expired && frozen === undefined) setFrozen(side);
  const shownSide = expired ? (frozen === undefined ? side : frozen) : side;

  const winning = shownSide === "winning";
  const profit = Math.floor((trade.stake * trade.payoutPct) / 100);
  // No quote yet, or price exactly at the entry: there is no result to show, so
  // a dash in neutral ink instead of a red loss.
  const undecided = shownSide === null || shownSide === "flat";
  const plText = undecided
    ? "—"
    : winning
      ? `+${formatMinor(grossReturnMinor(trade.stake, profit), currency)}`
      : `−${formatMinor(trade.stake, currency)}`;
  const plClass = undecided ? "text-ink-2" : winning ? "text-up" : "text-down";

  const total = trade.expiryTs - trade.entryTs;
  const remaining = now === null ? total : trade.expiryTs - now;
  const dirColor = up ? "text-up" : "text-down";
  const pair = asset ? splitAssetName(asset.displayName).pair : trade.symbol;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open trade: ${up ? "Buy" : "Sell"} ${pair}, ${formatMinor(trade.stake, currency)}${
        more > 0 ? `, and ${more} more` : ""
      }. Show trades and history`}
      className="pointer-events-auto flex h-12 w-full items-center gap-2.5 rounded-[14px] bg-tile pl-2 pr-3 text-left shadow-[0_14px_30px_-12px_rgba(0,0,0,.9)] transition-colors active:bg-tile-hi"
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className={`flex-none -rotate-90 ${dirColor}`}>
        <circle cx="17" cy="17" r="14" fill="none" strokeWidth="3" className="stroke-tile-hi" />
        <circle
          cx="17"
          cy="17"
          r="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={ringOffset(remaining, total)}
        />
      </svg>
      <span className="grid min-w-0 gap-px">
        <span className={`text-xs font-extrabold tracking-[0.04em] tabular-nums ${dirColor}`}>
          {up ? "BUY" : "SELL"} · {shortCountdown(remaining)}
        </span>
        <span className="truncate text-[11px] text-ink-2">
          {pair} · {formatMinor(trade.stake, currency)}
          {more > 0 ? <span className="text-ink-3"> · +{more} more</span> : null}
        </span>
      </span>
      <span className="ml-auto grid flex-none justify-items-end gap-px">
        <span className={`text-[15px] font-extrabold tabular-nums leading-tight ${plClass}`}>{plText}</span>
        <span className="text-[10px] leading-tight text-ink-3">if it closed now</span>
      </span>
      <Icon name="chevron" className="size-3.5 flex-none text-ink-3" strokeWidth={2.2} />
    </button>
  );
});

/**
 * Phone live-position strip: the soonest-expiring open trade on the active
 * account (countdown ring, direction, stake, live profit/loss), with "+N more"
 * when others are open. Tapping it opens the Trades & history sheet.
 */
export function PositionStrip({
  trades,
  assets,
  currency,
  onOpen,
  className = "",
}: {
  trades: readonly TradeView[];
  assets: PlatformAsset[];
  currency: string;
  onOpen: () => void;
  className?: string;
}) {
  const soonest = useMemo(() => soonestOpen(trades), [trades]);
  if (!soonest) return null;
  const { trade, more } = soonest;
  return (
    <div className={className}>
      <StripBody
        key={trade.id}
        trade={trade}
        more={more}
        asset={assets.find((a) => a.symbol === trade.symbol)}
        currency={currency}
        onOpen={onOpen}
      />
    </div>
  );
}
