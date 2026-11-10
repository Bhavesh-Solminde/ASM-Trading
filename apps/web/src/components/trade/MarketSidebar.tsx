"use client";
import { memo, useState } from "react";
import { usePlatform, useQuote, type PlatformAsset } from "@/components/shell/PlatformProvider";
import { useFavouriteMarkets } from "@/lib/use-favourite-markets";
import { AssetIcon } from "./AssetIcon";
import { isPopular } from "./market-groups";
const MarketRow = memo(function MarketRow({ asset, active, onSelect }: { asset: PlatformAsset; active: boolean; onSelect: (symbol: string) => void }) {
  const quote = useQuote(asset.symbol);
  return <button type="button" aria-pressed={active} onClick={() => onSelect(asset.symbol)} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left ${active ? "bg-brand/15 text-brand" : "hover:bg-tile"}`}>
    <AssetIcon symbol={asset.symbol} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{asset.displayName}</span><span className="text-[10px] text-ink-3">{asset.assetClass.toLowerCase()}</span></span>
    <span className="text-right text-xs tabular-nums">{quote?.price == null ? "—" : quote.price.toFixed(asset.precision)}</span>
  </button>;
});
export function MarketSidebar() {
  const { assets, chartSymbol, selectChartSymbol } = usePlatform();
  const { favourites } = useFavouriteMarkets();
  const [filter, setFilter] = useState("Popular"), [query, setQuery] = useState("");
  const shown = assets.filter(a => (filter === "All" || filter === "Popular" && isPopular(a.symbol) || filter === "Favourites" && favourites.has(a.symbol)) && `${a.symbol} ${a.displayName}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="market-sidebar" aria-label="Markets sidebar">
    <div className="px-3 pb-3 pt-4"><div className="mb-3 flex items-center justify-between"><strong className="text-sm">Markets</strong><span className="text-xs text-ink-3">{assets.length}</span></div>
      <input aria-label="Search sidebar markets" placeholder="Search markets" value={query} onChange={e => setQuery(e.target.value)} className="h-9 w-full rounded-lg border border-rule bg-ground px-2 text-xs" />
      <div className="mt-3 flex flex-wrap gap-1">{["Popular", "All", "Favourites"].map(f => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${filter === f ? "bg-brand-fill text-white" : "bg-tile text-ink-2"}`}>{f}</button>)}</div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-1.5">{shown.map(a => <MarketRow key={a.symbol} asset={a} active={a.symbol === chartSymbol} onSelect={selectChartSymbol} />)}{shown.length === 0 && <p className="p-3 text-xs text-ink-3">No matching markets.</p>}</div>
  </aside>;
}
