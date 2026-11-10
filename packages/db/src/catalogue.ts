/**
 * The tradeable catalogue — the shape of every market the platform lists.
 *
 * Lives apart from seed.ts (which executes on import) so tests can assert
 * invariants over it. The MSM volatility calibration for these symbols is in
 * packages/pricing/src/markets.ts; this file owns the presentation and
 * settlement scale.
 */

export interface SeedAsset {
  symbol: string;
  displayName: string;
  /**
   * All markets are now house-first with full algo authority. The DB `kind`
   * column is retained ("OTC" for every asset) so migrations and admin
   * tooling keep working, but the value has no operational meaning: the
   * engine treats every asset identically — 200-tick cap, self-anchor,
   * no external anchor pull. The distinction is not exposed to end users.
   */
  kind: "OTC";
  /**
   * Presentational grouping only — it drives the market picker's class tabs
   * in the trade UI and nothing in pricing or settlement.
   */
  assetClass: "FOREX" | "CRYPTO" | "COMMODITY" | "INDEX";
  /** Resume/synthetic base price. */
  basePrice: number;
  precision: number;
  /** tickSize drives maxTickMove (tickSize × 200 per tick) — keep it ~0.04% of price. */
  tickSize: number;
}

// DOGE and USD/JPY retain their settlement ticks but publish one finer decimal
// so the three-second cadence does not collapse their candles onto a coarse display grid.
// The tradeable catalogue — 30 assets, all house-first.
// displayName is what the trade UI shows; a trailing "(…)" is rendered as a
// small market qualifier next to the pair.
export const MARKETS: SeedAsset[] = [
  // Crypto
  { symbol: "BTCUSDT", displayName: "BTC/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 95_000, precision: 2, tickSize: 1.0 },
  { symbol: "ETHUSDT", displayName: "ETH/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 3_500, precision: 2, tickSize: 0.1 },
  { symbol: "SOLUSDT", displayName: "SOL/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 180, precision: 3, tickSize: 0.01 },
  { symbol: "BNBUSDT", displayName: "BNB/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 600, precision: 2, tickSize: 0.05 },
  { symbol: "XRPUSDT", displayName: "XRP/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 1.5, precision: 5, tickSize: 0.0001 },
  { symbol: "DOGEUSDT", displayName: "DOGE/USDT", kind: "OTC", assetClass: "CRYPTO", basePrice: 0.3, precision: 6, tickSize: 0.00001 },

  // Forex
  { symbol: "EURUSD", displayName: "EUR/USD", kind: "OTC", assetClass: "FOREX", basePrice: 1.08, precision: 6, tickSize: 0.00001 },
  { symbol: "GBPUSD", displayName: "GBP/USD", kind: "OTC", assetClass: "FOREX", basePrice: 1.27, precision: 6, tickSize: 0.00001 },
  { symbol: "USDJPY", displayName: "USD/JPY", kind: "OTC", assetClass: "FOREX", basePrice: 150.0, precision: 4, tickSize: 0.001 },
  { symbol: "USDCHF", displayName: "USD/CHF", kind: "OTC", assetClass: "FOREX", basePrice: 0.88, precision: 6, tickSize: 0.00001 },
  { symbol: "AUDUSD", displayName: "AUD/USD", kind: "OTC", assetClass: "FOREX", basePrice: 0.66, precision: 6, tickSize: 0.00001 },
  { symbol: "USDCAD", displayName: "USD/CAD", kind: "OTC", assetClass: "FOREX", basePrice: 1.36, precision: 6, tickSize: 0.00001 },

  // Commodities
  { symbol: "XAUUSD", displayName: "Gold (XAU/USD)", kind: "OTC", assetClass: "COMMODITY", basePrice: 2700, precision: 2, tickSize: 0.01 },

  // India indices
  { symbol: "NIFTY50", displayName: "NIFTY 50 (India)", kind: "OTC", assetClass: "INDEX", basePrice: 24_000, precision: 2, tickSize: 0.5 },
  { symbol: "BANKNIFTY", displayName: "BANK NIFTY (India)", kind: "OTC", assetClass: "INDEX", basePrice: 52_000, precision: 2, tickSize: 1.0 },
  { symbol: "FINNIFTY", displayName: "FINNIFTY (India)", kind: "OTC", assetClass: "INDEX", basePrice: 24_500, precision: 2, tickSize: 0.5 },
  { symbol: "SENSEX", displayName: "SENSEX (India)", kind: "OTC", assetClass: "INDEX", basePrice: 79_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYIT", displayName: "NIFTY IT (India)", kind: "OTC", assetClass: "INDEX", basePrice: 42_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYMIDCAP100", displayName: "NIFTY MIDCAP 100 (India)", kind: "OTC", assetClass: "INDEX", basePrice: 57_000, precision: 2, tickSize: 1.0 },
  // Additional markets from the verified bot catalogue.
  {"symbol": "ADAUSDT", "displayName": "ADA/USDT", "kind": "OTC", "assetClass": "CRYPTO", "basePrice": 0.5, "precision": 6, "tickSize": 1e-05},
  {"symbol": "LTCUSDT", "displayName": "LTC/USDT", "kind": "OTC", "assetClass": "CRYPTO", "basePrice": 80.0, "precision": 4, "tickSize": 0.0001},
  {"symbol": "LINKUSDT", "displayName": "LINK/USDT", "kind": "OTC", "assetClass": "CRYPTO", "basePrice": 15.0, "precision": 4, "tickSize": 0.0001},
  {"symbol": "DOTUSDT", "displayName": "DOT/USDT", "kind": "OTC", "assetClass": "CRYPTO", "basePrice": 3.0, "precision": 5, "tickSize": 1e-05},
  {"symbol": "NZDUSD", "displayName": "NZD/USD", "kind": "OTC", "assetClass": "FOREX", "basePrice": 0.56, "precision": 6, "tickSize": 1e-05},
  {"symbol": "EURGBP", "displayName": "EUR/GBP", "kind": "OTC", "assetClass": "FOREX", "basePrice": 0.83, "precision": 6, "tickSize": 1e-05},
  {"symbol": "EURJPY", "displayName": "EUR/JPY", "kind": "OTC", "assetClass": "FOREX", "basePrice": 177.0, "precision": 4, "tickSize": 0.0001},
  {"symbol": "GBPJPY", "displayName": "GBP/JPY", "kind": "OTC", "assetClass": "FOREX", "basePrice": 213.0, "precision": 4, "tickSize": 0.0001},
  {"symbol": "XAGUSD", "displayName": "Silver XAG/USD", "kind": "OTC", "assetClass": "COMMODITY", "basePrice": 50.0, "precision": 4, "tickSize": 0.0001},
  {"symbol": "WTI", "displayName": "WTI crude futures", "kind": "OTC", "assetClass": "COMMODITY", "basePrice": 65.0, "precision": 3, "tickSize": 0.001},
  {"symbol": "BRENT", "displayName": "Brent crude futures", "kind": "OTC", "assetClass": "COMMODITY", "basePrice": 70.0, "precision": 3, "tickSize": 0.001},
];
