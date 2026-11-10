"use client";
import { memo, useState } from "react";
import { usePlatform, useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { useFavouriteMarkets } from "@/lib/use-favourite-markets";
import { AssetIcon } from "./AssetIcon";
import { isPopular } from "./market-groups";
const MarketRow = memo(function MarketRow({ asset, active, onSelect }: { asset: PlatformAsset; active: boolean; onSelect: (symbol: string) => void }) {
  const quote = useQuote(asset.symbol);
  return <button type="button" aria-pressed={active} onClick={() => onSelect(asset.symbol)} className={`flex min-h-[76px] w-full items-center gap-3 rounded-lg px-3 py-4 text-left ${active ? "bg-brand/15 text-brand" : "hover:bg-tile"}`}>
    <AssetIcon symbol={asset.symbol} size="lg" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{asset.displayName}</span><span className="mt-1 block text-xs text-ink-3">{asset.assetClass.toLowerCase()}</span></span>
    <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{quote?.price == null ? "—" : quote.price.toFixed(asset.precision)}</span>
  </button>;
});
export function MarketSidebar() {
  const { assets, chartSymbol, selectChartSymbol } = usePlatform();
  const { favourites } = useFavouriteMarkets();
  const [filter, setFilter] = useState("Popular"), [query, setQuery] = useState("");
  const shown = assets.filter(a => (filter === "All" || filter === "Popular" && isPopular(a.symbol) || filter === "Favourites" && favourites.has(a.symbol)) && `${a.symbol} ${a.displayName}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="market-sidebar" aria-label="Markets sidebar">
    <div className="px-4 pb-4 pt-5"><div className="mb-4 flex items-center justify-between"><strong className="text-base">Markets</strong><span className="text-xs text-ink-3">{assets.length}</span></div>
      <input aria-label="Search sidebar markets" placeholder="Search markets" value={query} onChange={e => setQuery(e.target.value)} className="h-10 w-full rounded-lg border border-rule bg-ground px-3 text-sm" />
      <div className="mt-3 flex flex-wrap gap-1.5">{["Popular", "All", "Favourites"].map(f => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-2 text-xs font-bold ${filter === f ? "bg-brand-fill text-white" : "bg-tile text-ink-2"}`}>{f}</button>)}</div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-1.5">{shown.map(a => <MarketRow key={a.symbol} asset={a} active={a.symbol === chartSymbol} onSelect={selectChartSymbol} />)}{shown.length === 0 && <p className="p-3 text-xs text-ink-3">No matching markets.</p>}</div>
  </aside>;
}
