"use client";

export interface AssetTab {
  symbol: string;
  displayName: string;
  payoutPct: number;
}

export function AssetTabs({
  assets,
  active,
  onSelect,
}: {
  assets: AssetTab[];
  active: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {assets.map((asset) => {
        const selected = asset.symbol === active;
        return (
          <button
            key={asset.symbol}
            type="button"
            onClick={() => onSelect(asset.symbol)}
            className={`flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left ${
              selected
                ? "border-[var(--color-brand)] bg-[var(--color-panel-2)]"
                : "border-[var(--color-edge)] bg-[var(--color-panel)]"
            }`}
          >
            <span className="text-xs font-semibold">{asset.displayName}</span>
            <span className="text-[10px] font-bold tabular-nums text-[var(--color-up)]">
              {asset.payoutPct}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
