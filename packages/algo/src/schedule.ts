import {
  OTC_CLOSE_HOUR_IST,
  OTC_CLOSE_MIN_IST,
  OTC_NIGHTLY_CLOSE_MODE,
  OTC_OPEN_HOUR_IST,
  OTC_OPEN_MIN_IST,
} from "./constants";

/**
 * Phase 2D — nightly OTC market close.
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

/**
 * True whenever the current IST minute is inside the OTC nightly close
 * window [OTC_CLOSE, OTC_OPEN). With the shipped values that's
 * 23:30 → 05:00 IST — i.e. the window wraps midnight.
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
