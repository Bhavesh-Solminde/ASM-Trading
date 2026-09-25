"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { useDismiss } from "@/lib/use-dismiss";

function LivePayout({ asset }: { asset: PlatformAsset }) {
  const quote = useQuote(asset.symbol);
  return <>{quote?.payoutPct ?? asset.payoutPct}%</>;
}

/**
 * A single dropdown that replaces the old multi-tab strip: it shows the active
 * market with its live payout and opens a searchable list of every asset so the
 * trader can switch markets at will (Quotex-style).
 */
export function MarketSelector({
  assets,
  active,
  onSelect,
  compact = false,
  iconOnly = false,
}: {
  assets: PlatformAsset[];
  active: string;
  onSelect: (symbol: string) => void;
  /** Small chip trigger for the in-chart overlay (phone/tablet); dropdown is unchanged. */
  compact?: boolean;
  /** Square, icon-only trigger (the selected market still shows in the chart readout). */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useDismiss(rootRef, open, close);

  const activeAsset = assets.find((a) => a.symbol === active) ?? assets[0];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.displayName.toLowerCase().includes(q));
  }, [assets, query]);

  if (!activeAsset) return null;
  const { pair, market } = splitAssetName(activeAsset.displayName);

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-none">
      {iconOnly ? (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Change market"
          title="Change market"
          onClick={() => setOpen((o) => !o)}
          className={`grid size-7 place-items-center rounded-[4px] border backdrop-blur ${
            open ? "border-brand bg-tile/90 text-ink" : "border-rule bg-ground/75 text-ink-2 hover:border-tile-hi hover:text-ink"
          }`}
        >
          <Icon name="trade" className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={
            compact
              ? `grid grid-cols-[auto_auto_auto] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-left backdrop-blur ${
                  open ? "border-brand bg-tile/90" : "border-rule bg-ground/75 hover:border-tile-hi"
                }`
              : `grid grid-cols-[auto_auto_auto] items-center gap-2.5 rounded border px-3.5 py-2 text-left phone:gap-2 phone:px-3 phone:py-2.5 ${
                  open ? "border-brand bg-tile" : "border-rule bg-panel hover:border-tile-hi"
                }`
          }
        >
          <span className={compact ? "text-[13px] font-bold tracking-[0.02em]" : "text-sm font-bold tracking-[0.03em]"}>
            {pair}
            {market ? (
              <span className="ml-1.5 text-[9px] font-semibold tracking-[0.08em] text-ink-3">{market}</span>
            ) : null}
          </span>
          <span className={`font-bold text-brand ${compact ? "text-[11px]" : "text-xs"}`}>
            <LivePayout asset={activeAsset} />
          </span>
          <Icon name="caret" className={`size-4 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open ? (
        <>
          <div aria-hidden onClick={close} className="fixed inset-0 z-30 hidden bg-black/60 phone:block" />
          <div
            role="listbox"
            aria-label="Markets"
            className="absolute left-0 top-[calc(100%+6px)] z-40 w-[300px] max-w-[calc(100vw-20px)] overflow-hidden rounded border border-rule bg-[#2c3036] shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)] phone:fixed phone:inset-x-0 phone:bottom-0 phone:left-0 phone:top-auto phone:w-auto phone:max-w-none phone:rounded-b-none phone:border-x-0 phone:border-b-0"
          >
            <div className="border-b border-rule p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search markets…"
                aria-label="Search markets"
                className="h-9 w-full rounded-[2px] border border-rule bg-panel px-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand"
              />
            </div>
            <div className="max-h-[min(50vh,320px)] overflow-y-auto p-1.5 phone:pb-[max(8px,env(safe-area-inset-bottom))]">
              {filtered.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-ink-3">No markets match “{query}”.</p>
              ) : (
                filtered.map((asset) => {
                  const selected = asset.symbol === active;
                  const parts = splitAssetName(asset.displayName);
                  return (
                    <button
                      key={asset.symbol}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelect(asset.symbol);
                        close();
                      }}
                      className={`flex w-full items-baseline justify-between rounded-[2px] px-2.5 py-2.5 text-left hover:bg-tile ${
                        selected ? "bg-tile shadow-[inset_0_0_0_1px_var(--color-tile-hi)]" : ""
                      }`}
                    >
                      <span className="text-sm font-bold tracking-[0.03em]">
                        {parts.pair}
                        {parts.market ? (
                          <span className="ml-1.5 text-[9px] font-semibold tracking-[0.08em] text-ink-3">
                            {parts.market}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs font-bold text-brand">
                        <LivePayout asset={asset} />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
