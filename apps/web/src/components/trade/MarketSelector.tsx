"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useQuote, type AssetClass, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { splitAssetName } from "@/lib/asset-name";
import { useDismiss } from "@/lib/use-dismiss";
import { useFavouriteMarkets } from "@/lib/use-favourite-markets";
import { AssetIcon } from "./AssetIcon";

/** Tab order for the class filter; "FAV" and "ALL" are filters, not classes. */
const CLASS_TABS: readonly { key: AssetClass; label: string }[] = [
  { key: "FOREX", label: "Currencies" },
  { key: "CRYPTO", label: "Crypto" },
  { key: "COMMODITY", label: "Commodities" },
  { key: "INDEX", label: "Indices" },
];

type Filter = "ALL" | "FAV" | AssetClass;

function LivePayout({ asset }: { asset: PlatformAsset }) {
  const quote = useQuote(asset.symbol);
  return <>{quote?.payoutPct ?? asset.payoutPct}%</>;
}

/**
 * A single dropdown that replaces the old multi-tab strip: it shows the active
 * market with its live payout and opens a searchable list of every asset so the
 * trader can switch markets at will (Quotex-style).
 *
 * On phones and portrait tablets (`phone:`) the list is not a dropdown at all —
 * it takes the whole screen, with a titled header, the class tabs and the search
 * field pinned at the top and the list scrolling underneath, because a 50vh
 * bottom sheet shows barely four markets on a phone.
 */
export function MarketSelector({
  assets,
  active,
  onSelect,
  compact = false,
  iconOnly = false,
  onOpenChange,
}: {
  assets: PlatformAsset[];
  active: string;
  onSelect: (symbol: string) => void;
  /** Small chip trigger for the in-chart overlay (phone/tablet); dropdown is unchanged. */
  compact?: boolean;
  /** Square, icon-only trigger (the selected market still shows in the chart readout). */
  iconOnly?: boolean;
  /** Called when markets picker opens or closes */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { favourites, toggle: toggleFavourite } = useFavouriteMarkets();

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
    setQuery("");
    setFilter("ALL");
  }, [onOpenChange]);
  useDismiss(rootRef, open, close);

  // Focus the search box on open only where there's a hardware keyboard; on
  // touch it would pop the on-screen keyboard over the list.
  const focusSearch = useCallback((el: HTMLInputElement | null) => {
    if (el && window.matchMedia("(pointer: fine)").matches) el.focus();
  }, []);

  // The phone panel covers the whole screen, so Escape is the only way out for
  // a keyboard user — the backdrop isn't reachable.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const activeAsset = assets.find((a) => a.symbol === active) ?? assets[0];

  // Only offer tabs for classes the catalogue actually has, so a single-market
  // class that gets retired doesn't leave a dead tab behind.
  const tabs = useMemo(
    () => CLASS_TABS.filter((t) => assets.some((a) => a.assetClass === t.key)),
    [assets],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter === "FAV" && !favourites.has(a.symbol)) return false;
      if (filter !== "ALL" && filter !== "FAV" && a.assetClass !== filter) return false;
      if (!q) return true;
      return a.displayName.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q);
    });
  }, [assets, query, filter, favourites]);

  if (!activeAsset) return null;
  const { pair, market } = splitAssetName(activeAsset.displayName);

  const pillClass = (selected: boolean): string =>
    `inline-flex h-9 flex-none items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
      selected ? "bg-brand-fill text-white" : "bg-tile-hi text-ink-2 hover:text-ink"
    }`;

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-none">
      {iconOnly ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Change market"
          title="Change market"
          onClick={toggleOpen}
          className={`grid size-[34px] phone:size-10 place-items-center rounded-[4px] border backdrop-blur ${
            open
              ? "border-brand bg-brand/25 text-brand"
              : "border-brand/50 bg-brand/15 text-brand hover:border-brand hover:bg-brand/25"
          }`}
        >
          <Icon name="trade" className="size-5" />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggleOpen}
          className={
            compact
              ? `flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-left backdrop-blur ${
                  open ? "border-brand bg-tile/90" : "border-rule bg-ground/75 hover:border-tile-hi"
                }`
              : `flex items-center gap-2.5 rounded border px-3.5 py-2 text-left phone:gap-2 phone:px-3 phone:py-2.5 ${
                  open ? "border-brand bg-tile" : "border-rule bg-panel hover:border-tile-hi"
                }`
          }
        >
          <AssetIcon symbol={activeAsset.symbol} size={compact ? "sm" : "md"} />
          <span className={compact ? "text-[13px] font-bold tracking-[0.02em]" : "text-sm font-bold tracking-[0.03em]"}>
            {pair}
            {market ? (
              <span className="ml-1.5 text-[9px] font-semibold tracking-[0.08em] text-ink-3">{market}</span>
            ) : null}
          </span>
          <span className={`font-bold text-brand ml-1 ${compact ? "text-[11px]" : "text-xs"}`}>
            <LivePayout asset={activeAsset} />
          </span>
          <Icon name="caret" className={`size-4 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open ? (
        <>
          <div aria-hidden onClick={close} className="fixed inset-0 z-50 hidden bg-black/60 phone:block" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Select trade pair"
            className="absolute left-0 top-[calc(100%+6px)] z-50 flex w-[320px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded border border-tile-hi bg-tile shadow-[0_24px_48px_-12px_rgba(0,0,0,.8)] phone:fixed phone:inset-0 phone:left-0 phone:top-0 phone:z-[60] phone:w-auto phone:max-w-none phone:rounded-none phone:border-0"
          >
            {/* Title bar — phone only; on desktop the trigger button is the title. */}
            <div className="hidden items-center justify-between gap-3 border-b border-rule px-3.5 pb-2.5 pt-[max(12px,env(safe-area-inset-top))] phone:flex">
              <h2 className="text-sm font-semibold text-ink">Select trade pair</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close market list"
                className="grid size-8 place-items-center rounded-[3px] text-ink-2 hover:bg-tile-hi hover:text-ink phone:size-10"
              >
                <Icon name="close" className="size-4" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-none border-b border-rule p-2">
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                />
                <input
                  ref={focusSearch}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search markets…"
                  aria-label="Search markets"
                  className="h-9 w-full rounded-lg border border-rule bg-panel pl-8 pr-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand phone:h-11"
                />
              </div>

              {/* One scrollable row, faded at the ends so a clipped chip reads as "more". */}
              <div className="edge-fade-x -mx-2 mt-2 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
                <button
                  type="button"
                  aria-pressed={filter === "FAV"}
                  aria-label="Show favourites only"
                  onClick={() => setFilter((f) => (f === "FAV" ? "ALL" : "FAV"))}
                  className={pillClass(filter === "FAV")}
                >
                  <Icon name="star" className="size-4" fill={favourites.size ? "currentColor" : "none"} />
                  Favourites
                  <span className="tabular-nums opacity-80">{favourites.size}</span>
                </button>
                <button type="button" onClick={() => setFilter("ALL")} className={pillClass(filter === "ALL")}>
                  All
                </button>
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(t.key)}
                    className={pillClass(filter === t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              role="list"
              aria-label="Markets"
              className="max-h-[min(50vh,320px)] overflow-y-auto p-1.5 phone:max-h-none phone:min-h-0 phone:flex-1 phone:pb-[max(8px,env(safe-area-inset-bottom))]"
            >
              {filtered.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-ink-3">
                  {query.trim()
                    ? `No markets match “${query}”.`
                    : filter === "FAV"
                      ? "No favourites yet — tap a star to add one."
                      : "No markets in this category."}
                </p>
              ) : (
                filtered.map((asset) => {
                  const selected = asset.symbol === active;
                  const starred = favourites.has(asset.symbol);
                  const parts = splitAssetName(asset.displayName);
                  return (
                    <div
                      key={asset.symbol}
                      role="listitem"
                      className={`flex w-full items-center gap-1 rounded-[3px] transition-colors phone:min-h-[52px] phone:rounded-lg hover:bg-tile-hi ${
                        selected ? "bg-tile-hi text-ink" : ""
                      }`}
                    >
                      <button
                        type="button"
                        aria-current={selected}
                        onClick={() => {
                          onSelect(asset.symbol);
                          close();
                        }}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2.5 py-2 text-left phone:py-3"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <AssetIcon symbol={asset.symbol} size="md" />
                          <span className="truncate text-sm font-bold tracking-[0.03em]">
                            {parts.pair}
                            {parts.market ? (
                              <span className="ml-1.5 text-[9px] font-semibold tracking-[0.08em] text-ink-3">
                                {parts.market}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-bold tabular-nums leading-none text-brand">
                          <LivePayout asset={asset} />
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={starred}
                        aria-label={`${starred ? "Remove" : "Add"} ${parts.pair} ${starred ? "from" : "to"} favourites`}
                        onClick={() => toggleFavourite(asset.symbol)}
                        className={`grid size-8 flex-none place-items-center rounded-[3px] phone:size-10 ${
                          starred ? "text-brand" : "text-ink-3 hover:text-ink"
                        }`}
                      >
                        <Icon name="star" className="size-4" fill={starred ? "currentColor" : "none"} />
                      </button>
                    </div>
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
