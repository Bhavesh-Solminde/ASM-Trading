"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { useDismiss } from "@/lib/use-dismiss";

const INITIAL_TABS = 3;

function LivePayout({ asset }: { asset: PlatformAsset }) {
  const quote = useQuote(asset.symbol);
  return <>{quote?.payoutPct ?? asset.payoutPct}%</>;
}

export function AssetTabs({
  assets,
  active,
  onSelect,
}: {
  assets: PlatformAsset[];
  active: string;
  onSelect: (symbol: string) => void;
}) {
  const [opened, setOpened] = useState<string[]>(() => {
    const first = assets.slice(0, INITIAL_TABS).map((a) => a.symbol);
    return first.includes(active) ? first : [active, ...first.slice(0, INITIAL_TABS - 1)];
  });
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const closePicker = useCallback(() => setPicking(false), []);
  useDismiss(pickerRef, picking, closePicker);

  const shown = opened.includes(active) ? opened : [...opened, active];
  const closed = assets.filter((a) => !shown.includes(a.symbol));

  function closeTab(symbol: string): void {
    const next = shown.filter((s) => s !== symbol);
    if (next.length === 0) return;
    setOpened(next);
    if (symbol === active) onSelect(next.at(-1)!);
  }

  return (
    <div className="flex min-w-0 items-stretch gap-1.5">
      <div ref={pickerRef} className="relative flex flex-none">
        <button
          type="button"
          aria-label="Open another asset"
          aria-expanded={picking}
          disabled={closed.length === 0}
          title={closed.length === 0 ? "Every asset is already open" : undefined}
          onClick={() => setPicking((p) => !p)}
          className="grid w-11 place-items-center rounded border border-dashed border-tile-hi text-ink-2 hover:border-brand hover:text-brand disabled:cursor-default disabled:hover:border-tile-hi disabled:hover:text-ink-2"
        >
          <Icon name="plus" />
        </button>
        {picking ? (
          <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-60 rounded border border-rule bg-[#2c3036] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)]">
            {closed.map((asset) => (
              <button
                key={asset.symbol}
                type="button"
                onClick={() => {
                  setOpened([...shown, asset.symbol]);
                  onSelect(asset.symbol);
                  setPicking(false);
                }}
                className="flex w-full items-baseline justify-between rounded-[2px] px-2.5 py-2 text-left hover:bg-tile"
              >
                <span className="text-sm font-bold">{asset.displayName}</span>
                <span className="text-xs font-bold text-brand">
                  <LivePayout asset={asset} />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div role="tablist" aria-label="Open assets" className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {shown.map((symbol) => {
          const asset = assets.find((a) => a.symbol === symbol);
          if (!asset) return null;
          const selected = symbol === active;
          const { pair, market } = splitAssetName(asset.displayName);
          return (
            <div key={symbol} className="group relative flex-none">
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelect(symbol)}
                className={`grid min-w-[150px] grid-cols-[auto_auto] items-baseline justify-between gap-x-3 rounded border px-3.5 py-2 text-left phone:min-w-[118px] phone:py-2.5 pointer-coarse:pr-8 ${
                  selected
                    ? "border-ink-3 bg-tile shadow-[inset_0_-2px_0_var(--color-brand)]"
                    : "border-rule bg-panel hover:border-tile-hi"
                }`}
              >
                <span className="text-sm font-bold tracking-[0.03em]">
                  {pair}
                  {market ? <span className="ml-1.5 text-[9px] font-semibold tracking-[0.08em] text-ink-3">{market}</span> : null}
                </span>
                <span className="text-xs font-bold text-brand">
                  <LivePayout asset={asset} />
                </span>
              </button>
              {shown.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Close ${asset.displayName}`}
                  onClick={() => closeTab(symbol)}
                  className="absolute right-1 top-1 hidden size-4 place-items-center rounded-[2px] bg-tile-hi text-ink-2 hover:text-ink group-focus-within:grid group-hover:grid pointer-coarse:grid pointer-coarse:size-7 pointer-coarse:-right-1 pointer-coarse:-top-1 pointer-coarse:rounded-full"
                >
                  <Icon name="close" className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
