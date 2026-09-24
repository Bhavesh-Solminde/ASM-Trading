import {
  OTC_CLOSE_HOUR_IST,
  OTC_CLOSE_MIN_IST,
  OTC_NIGHTLY_CLOSE_MODE,
  OTC_OPEN_HOUR_IST,
  OTC_OPEN_MIN_IST,
} from "./constants";

/**
 * Phase 2D — nightly market close.
 *
 * Originally introduced for OTC assets only; now that every asset is
 * house-first, the *nightly* close is scoped to the India-indices set
 * (NIFTY50, BANKNIFTY, FINNIFTY, SENSEX, NIFTYIT, NIFTYMIDCAP100) so
 * crypto and forex — which trade around the clock in the real world —
 * remain open.
 *
 * IST is a fixed UTC+05:30 offset (no DST), so the window collapses to a
 * simple minute-of-day comparison computed from UTC. Doing it this way avoids
 * pulling a timezone library into the algo package.
 */

const IST_OFFSET_MIN = 5 * 60 + 30;

function minuteOfIstDay(nowMs: number): number {
  const utcMinutes = Math.floor(nowMs / 60_000);
  return ((utcMinutes + IST_OFFSET_MIN) % 1440 + 1440) % 1440;
}

const CLOSE_MOD = OTC_CLOSE_HOUR_IST * 60 + OTC_CLOSE_MIN_IST;
const OPEN_MOD = OTC_OPEN_HOUR_IST * 60 + OTC_OPEN_MIN_IST;

/** Symbols that observe an Indian-market-hours nightly close. */
export const INDIA_MARKET_SYMBOLS: ReadonlySet<string> = new Set([
  "NIFTY50",
  "BANKNIFTY",
  "FINNIFTY",
  "SENSEX",
  "NIFTYIT",
  "NIFTYMIDCAP100",
]);

/**
 * True whenever the current IST minute is inside the nightly close window
 * [CLOSE, OPEN). With the shipped values that's 23:30 → 05:00 IST — i.e.
 * the window wraps midnight. This tells you the window is currently active;
 * whether the *asset* observes it is a separate concern
 * (`isSymbolClosedForNight`).
 *
 * Returns false unconditionally when `OTC_NIGHTLY_CLOSE_MODE=off`.
 */
export function isOtcMarketClosed(nowMs: number = Date.now()): boolean {
  if (!OTC_NIGHTLY_CLOSE_MODE) return false;
  const m = minuteOfIstDay(nowMs);
  // Window wraps midnight when close > open (which is our case: 1410 > 300).
  if (CLOSE_MOD > OPEN_MOD) return m >= CLOSE_MOD || m < OPEN_MOD;
  return m >= CLOSE_MOD && m < OPEN_MOD;
}

/**
 * True when the specific `symbol` is currently in its nightly close window.
 * Only the India-indices set (`INDIA_MARKET_SYMBOLS`) observes a close;
 * crypto and forex are 24/7 and always return false.
 */
export function isSymbolClosedForNight(
  symbol: string,
  nowMs: number = Date.now(),
): boolean {
  if (!INDIA_MARKET_SYMBOLS.has(symbol)) return false;
  return isOtcMarketClosed(nowMs);
}
