"use client";

import { memo } from "react";
import { changePct, tickDirection } from "./quotes";
import { usePlatform, useQuote, type PlatformAsset } from "./PlatformProvider";

/** Copies per half of the track, so each half is wider than the viewport. */
const MIN_ITEMS_PER_HALF = 6;

/** Memoised and subscribed to its own symbol, so a tick re-renders only its copies. */
const TickerItem = memo(function TickerItem({ asset, hidden }: { asset: PlatformAsset; hidden: boolean }) {
  const quote = useQuote(asset.symbol);
  if (!quote) return null;

  const change = changePct(quote);
  const up = (change ?? 0) >= 0;
  const flash = tickDirection(quote);
  const color = up ? "var(--color-up)" : "var(--color-down)";

  return (
    <span aria-hidden={hidden || undefined} className="flex items-center gap-[9px] whitespace-nowrap border-r border-rule px-[18px] text-xs">
      <span className="font-bold tracking-[0.03em]">{asset.displayName}</span>
      {/* Keyed on price so each tick remounts the span and replays the flash. */}
      <span
        key={quote.price ?? "none"}
        className={`led rounded-[2px] px-[3px] py-px font-bold ${flash ? `tick-${flash}` : ""}`}
      >
        {quote.price === null ? "—" : quote.price.toFixed(asset.precision)}
      </span>
      {change === null ? null : (
        <>
          <span aria-hidden className="dir-mark" data-dir={up ? "up" : "down"} style={{ color }} />
          <span className="font-bold" style={{ color }}>
            {up ? "+" : "−"}
            {Math.abs(change).toFixed(2)}%
          </span>
        </>
      )}
      <span className="font-bold text-brand">{quote.payoutPct}%</span>
    </span>
  );
});

export function Ticker() {
  const { assets } = usePlatform();
  if (assets.length === 0) return <div className="col-span-full row-start-2 border-b border-rule bg-panel" />;

  const repeats = Math.ceil(MIN_ITEMS_PER_HALF / assets.length);
  const half = Array.from({ length: repeats }, () => assets).flat();
  const items = [...half, ...half];

  return (
    <div
      aria-label="Live prices"
      className="ticker col-span-full row-start-2 min-w-0 overflow-hidden border-b border-rule bg-panel"
    >
      <div className="ticker-track flex h-full w-max items-stretch">
        {items.map((asset, i) => (
          <TickerItem key={`${asset.symbol}-${i}`} asset={asset} hidden={i >= assets.length} />
        ))}
      </div>
    </div>
  );
}
