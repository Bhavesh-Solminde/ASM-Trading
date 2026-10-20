import { BONUS_TIERS, bonusPercentForDeposit } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";

/** A listed market, as bootstrap delivers it. */
export type AppAsset = Bootstrap["assets"][number];

export function toggleFavourite(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
}

/** Markets matching the search (name or symbol, any case), split into starred and the rest. */
export function filterMarkets(assets: readonly AppAsset[], query: string, favourites: readonly string[]) {
  const q = query.trim().toLowerCase();
  const hit = (a: AppAsset) => !q || a.symbol.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q);
  const matched = assets.filter(hit);
  return {
    favourites: matched.filter((a) => favourites.includes(a.symbol)),
    rest: matched.filter((a) => !favourites.includes(a.symbol)),
  };
}

export function findAsset(assets: readonly AppAsset[], symbol: string | null | undefined): AppAsset | undefined {
  return symbol ? assets.find((a) => a.symbol === symbol) : undefined;
}

/** The saved market while it is still listed, else the server's default, else the first listed one. */
export function resolveSymbol(assets: readonly AppAsset[], saved: string | null, fallback: string): string | null {
  if (findAsset(assets, saved)) return saved;
  if (findAsset(assets, fallback)) return fallback;
  return assets[0]?.symbol ?? null;
}

/** The live payout (pushed over the socket) wins over the one bootstrap listed. */
export function payoutPctFor(asset: AppAsset | undefined, live: number | null): number | null {
  return live ?? asset?.payoutPct ?? null;
}

export function precisionFor(asset: AppAsset | undefined, fallback = 2): number {
  return asset?.precision ?? fallback;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** Sentiment bar input: an even split until the first reading arrives. */
export function sentimentSplit(s: { upPct: number; downPct: number } | null): { upPct: number; downPct: number } {
  return s ? { upPct: clampPct(s.upPct), downPct: clampPct(s.downPct) } : { upPct: 50, downPct: 50 };
}

export type BonusTierState = "claimed" | "next" | "upcoming";

/**
 * The deposit-bonus ladder for a user who has completed `completedDeposits` deposits: the next tier's
 * percent (0 once all are used) and every tier with its state. Wording stays "Bonus", as on the web.
 */
export function nextBonus(completedDeposits: number): {
  pct: number;
  tiers: { n: number; pct: number; state: BonusTierState }[];
} {
  const done = Math.max(0, Math.floor(completedDeposits));
  return {
    pct: bonusPercentForDeposit(done + 1),
    tiers: BONUS_TIERS.map((pct, i) => {
      const n = i + 1;
      return { n, pct, state: n <= done ? "claimed" : n === done + 1 ? "next" : "upcoming" };
    }),
  };
}

export type MarketCategory = "all" | "starred" | "CRYPTO" | "INDEX" | "FOREX" | "COMMODITY";
const CLASS_ORDER = ["CRYPTO", "INDEX", "FOREX", "COMMODITY"] as const;

/** Chips for the markets sheet: All, Starred (if any are starred), then the asset classes present. */
export function categoriesFor(assets: readonly { assetClass: string }[], favourites: readonly string[]): MarketCategory[] {
  const present = new Set(assets.map((x) => x.assetClass));
  return ["all", ...(favourites.length > 0 ? (["starred"] as const) : []), ...CLASS_ORDER.filter((c) => present.has(c))];
}

export function inCategory(asset: { symbol: string; assetClass: string }, category: MarketCategory, favourites: readonly string[]): boolean {
  if (category === "all") return true;
  if (category === "starred") return favourites.includes(asset.symbol);
  return asset.assetClass === category;
}
