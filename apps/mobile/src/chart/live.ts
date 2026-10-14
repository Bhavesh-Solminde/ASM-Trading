import type { CandleDto } from "@asm/contracts";
import type { PriceRange } from "./types";

/** Tick-driven history rebuilds are limited to this cadence; the live layer redraws per tick. */
export const HISTORY_INTERVAL_MS = 250;

export interface HistoryCommit {
  /** The price range the history layer (and the live layer, for coherence) is drawn with. */
  range: PriceRange;
  /** The structural inputs this range was committed for; any change commits immediately. */
  key: readonly unknown[];
  /** Epoch ms of the commit. */
  at: number;
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const sameRange = (a: PriceRange, b: PriceRange) => a.min === b.min && a.max === b.max;

/**
 * Throttle for the history layer. A structural change (pan, zoom, resize, a new closed candle, chart type)
 * commits the live range straight away; a range change alone (a tick moved the forming candle or last
 * price) only commits once `interval` ms have passed since the last commit. Returns `prev` itself when
 * nothing is committed, so callers can memoise on the object.
 */
export function nextHistoryRange(
  prev: HistoryCommit | null,
  live: PriceRange,
  key: readonly unknown[],
  nowMs: number,
  interval = HISTORY_INTERVAL_MS,
): HistoryCommit {
  if (prev === null || !sameKey(prev.key, key)) return { range: live, key, at: nowMs };
  if (sameRange(prev.range, live)) return prev;
  return nowMs - prev.at >= interval ? { range: live, key, at: nowMs } : prev;
}

/** Ms until a held-back range may be committed (so a quiet market still flushes), or null if none is held back. */
export function historyRetryDelay(
  prev: HistoryCommit,
  live: PriceRange,
  nowMs: number,
  interval = HISTORY_INTERVAL_MS,
): number | null {
  if (sameRange(prev.range, live)) return null;
  return Math.max(0, interval - (nowMs - prev.at));
}

/**
 * How many older candles were prepended, judged by the first candle moving earlier. Zero for a first load,
 * an emptied list, a first candle that was not simply pushed right (symbol change), or one trimmed away.
 */
export function prependedCount(prevFirstTs: number | null, candles: readonly CandleDto[]): number {
  const first = candles[0];
  if (prevFirstTs === null || first === undefined || first.openTs >= prevFirstTs) return 0;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ts = candles[mid]!.openTs;
    if (ts === prevFirstTs) return mid;
    if (ts < prevFirstTs) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

export interface EdgeState {
  near: boolean;
  firstTs: number | null;
}

/**
 * Request older candles when the view enters the near-left zone, and again when a batch arrived
 * (the first candle moved) while it is still there. Not on every frame spent inside the zone.
 */
export function shouldRequestOlder(prev: EdgeState, next: EdgeState): boolean {
  if (!next.near || next.firstTs === null) return false;
  return !prev.near || prev.firstTs !== next.firstTs;
}

/** Within half a candle of the live edge counts as following it. */
export const isFollowing = (rightIndex: number, total: number) => rightIndex >= total - 0.5;
