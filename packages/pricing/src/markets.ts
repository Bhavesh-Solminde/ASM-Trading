/**
 * Per-market MSM calibration for our 19 tradeable symbols.
 *
 * `sigma` is the long-run volatility of log price per √second, measured on a
 * comparable real instrument in Oct 2026. `m0` is the MSM layer strength
 * (higher = fatter tails, wilder bursts). `profile` is one of the five
 * intraday families from `intraday.ts`.
 *
 * These are PHYSICS, not business config: tuning them requires re-running
 * the realism benchmark against real market data. The DB mirrors these on
 * `Asset.msmSigma / msmM0 / intradayProfile` so an operator can tweak
 * values in the admin without a deploy, but the seed is the canonical
 * source of truth and new markets should land here first.
 */

import type { IntradayProfileName } from "./intraday";
import type { NewsParams } from "./news";
import { msmMedianMultiplier, type MsmParams } from "./msm";
import { TICK_DT_SEC } from "./step";

export interface MarketMsmCalibration {
  readonly symbol: string;
  readonly sigma: number;
  readonly m0: number;
  readonly profile: IntradayProfileName;
}

export const MARKET_CALIBRATIONS: readonly MarketMsmCalibration[] = [
  // Crypto — m0 1.55, CRYPTO profile.
  { symbol: "BTCUSDT", sigma: 5.78e-5, m0: 1.55, profile: "CRYPTO" },
  { symbol: "ETHUSDT", sigma: 7.31e-5, m0: 1.55, profile: "CRYPTO" },
  { symbol: "BNBUSDT", sigma: 6.59e-5, m0: 1.55, profile: "CRYPTO" },
  { symbol: "SOLUSDT", sigma: 9.33e-5, m0: 1.55, profile: "CRYPTO" },
  { symbol: "DOGEUSDT", sigma: 1.15e-4, m0: 1.55, profile: "CRYPTO" },
  { symbol: "XRPUSDT", sigma: 1.03e-4, m0: 1.55, profile: "CRYPTO" },

  // Forex majors — m0 1.5. FX_MAJOR for European/NA pairs, FX_PACIFIC for AUD/JPY.
  { symbol: "AUDUSD", sigma: 1.38e-5, m0: 1.5, profile: "FX_PACIFIC" },
  { symbol: "EURUSD", sigma: 1.04e-5, m0: 1.5, profile: "FX_MAJOR" },
  { symbol: "GBPUSD", sigma: 1.09e-5, m0: 1.5, profile: "FX_MAJOR" },
  { symbol: "USDCAD", sigma: 9.65e-6, m0: 1.5, profile: "FX_MAJOR" },
  { symbol: "USDCHF", sigma: 1.51e-5, m0: 1.5, profile: "FX_MAJOR" },
  { symbol: "USDJPY", sigma: 1.97e-5, m0: 1.5, profile: "FX_PACIFIC" },

  // Metal.
  { symbol: "XAUUSD", sigma: 4.63e-5, m0: 1.5, profile: "METAL" },

  // India indices — m0 1.45, INDEX profile. Sigmas are the real in-session
  // volatility divided by 1.527 (the in-session level of INDEX_INTRADAY) so
  // the busy hours match the real session and after-hours stay quiet.
  { symbol: "BANKNIFTY", sigma: 2.42e-5, m0: 1.45, profile: "INDEX" },
  { symbol: "FINNIFTY", sigma: 2.46e-5, m0: 1.45, profile: "INDEX" },
  { symbol: "NIFTY50", sigma: 1.88e-5, m0: 1.45, profile: "INDEX" },
  { symbol: "NIFTYIT", sigma: 4.41e-5, m0: 1.45, profile: "INDEX" },
  { symbol: "NIFTYMIDCAP100", sigma: 2.37e-5, m0: 1.45, profile: "INDEX" },
  { symbol: "SENSEX", sigma: 1.93e-5, m0: 1.45, profile: "INDEX" },
];

export function findMarketCalibration(symbol: string): MarketMsmCalibration | undefined {
  return MARKET_CALIBRATIONS.find((m) => m.symbol === symbol);
}

/**
 * The fewest display steps a market may move per price update before its
 * candles stop looking like candles.
 *
 * Below ~3 the price can only reach a handful of distinct values inside a
 * one-minute bar, so every candle renders as the same one-step rectangle with
 * no wick — the lattice that made XRP/USDT look mechanical in Oct 2026. Three
 * is the floor, not the target; most of the catalogue sits far above it.
 */
export const MIN_DISPLAY_STEPS_PER_UPDATE = 3;

/**
 * How many display steps a market moves in one price update, in its typical
 * (median) volatility regime.
 *
 * `precision` is the grid the shown price snaps to — the engine publishes
 * every price through toFixed(precision) — so this is the resolution the
 * chart actually gets, whatever the model computes underneath. A market whose
 * answer is below 1 cannot render a wick at all.
 */
export function displayStepsPerUpdate(input: {
  readonly sigma: number;
  readonly m0: number;
  readonly price: number;
  readonly precision: number;
  readonly dtSec?: number;
}): number {
  const { sigma, m0, price, precision, dtSec = TICK_DT_SEC } = input;
  const median = msmMedianMultiplier(marketMsm(sigma, m0));
  const move = sigma * Math.sqrt(dtSec) * median * price;
  return move / 10 ** -precision;
}

/**
 * The MSM settings every market shares; only `sigma` and `m0` differ.
 * 8 layers, fastest re-draws every ~1 s, slowest every ~3 days.
 */
export function marketMsm(sigma: number, m0: number): MsmParams {
  return { sigma, components: 8, m0, fastestSec: 1, slowestSec: 3 * 86400 };
}

/**
 * News shocks every market shares: about 1.5 a day, peaking at ~5× normal
 * volatility and fading over ~10 minutes. Brings the tails of 1h returns up
 * toward real FX and crypto without inflating 1m/5m tails.
 */
export const MARKET_NEWS: NewsParams = {
  perDay: 1.5,
  peak: 5,
  peakSpread: 0.5,
  decaySec: 600,
};
