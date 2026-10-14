import type { CandleDto } from "@asm/contracts";
import { shiftForPrepend } from "./scale";
import type { PriceRange, Viewport } from "./types";

/** Tick-driven history rebuilds are limited to this cadence; the live layer redraws per tick. */
export const HISTORY_INTERVAL_MS = 250;

/** Entry-wise identity comparison of two structural keys. */
export function isSameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

const sameRange = (a: PriceRange, b: PriceRange) => a.min === b.min && a.max === b.max;

/**
 * Ms until a held-back range may be committed to the history layer (so a quiet market still flushes),
 * or null if the live range equals the committed one. Structural changes (pan, zoom, resize, new
 * candle) are committed immediately by the caller and never wait.
 */
export function historyRetryDelay(
  committed: PriceRange,
  committedAtMs: number,
  live: PriceRange,
  nowMs: number,
  interval = HISTORY_INTERVAL_MS,
): number | null {
  if (sameRange(committed, live)) return null;
  return Math.max(0, interval - (nowMs - committedAtMs));
}

const indexOfOpenTs = (candles: readonly CandleDto[], openTs: number): number => {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ts = candles[mid]!.openTs;
    if (ts === openTs) return mid;
    if (ts < openTs) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
};

/**
 * By how many indices the candles on screen moved when the list changed at the front: positive when
 * older candles were prepended, negative when the front was trimmed (the retention cap). Zero when the
 * first candle did not move, a list is empty, or the lists do not overlap (symbol change).
 */
export function firstCandleShift(prev: readonly CandleDto[], next: readonly CandleDto[]): number {
  const before = prev[0];
  const after = next[0];
  if (before === undefined || after === undefined || before.openTs === after.openTs) return 0;
  if (after.openTs < before.openTs) return Math.max(0, indexOfOpenTs(next, before.openTs));
  const trimmed = indexOfOpenTs(prev, after.openTs);
  return trimmed > 0 ? -trimmed : 0;
}

/**
 * A gesture's start viewport, moved by the index shift that landed since the gesture began, so a
 * prepend (or trim) mid-gesture keeps the same candles under the finger.
 */
export const startViewport = (start: Viewport, shiftAtStart: number, shiftNow: number): Viewport =>
  shiftForPrepend(start, shiftNow - shiftAtStart);

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
