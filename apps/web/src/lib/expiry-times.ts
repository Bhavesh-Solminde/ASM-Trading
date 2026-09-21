import { DURATIONS_SEC } from "@asm/trading";

/** One selectable expiry: an offered duration and the clock time it lands on. */
export interface ExpirySlot {
  readonly durationSec: number;
  readonly epochMs: number;
}

/**
 * The expiry clock times offered in TIME mode. The engine only settles at
 * `entryTs + durationSec` for one of the discrete offered durations (the API
 * rejects anything else), so each "time" is really one of those durations
 * rendered as the wall-clock moment it would expire — now + duration.
 */
export function offeredExpirySlots(
  nowMs: number,
  durations: readonly number[] = DURATIONS_SEC,
): ExpirySlot[] {
  return durations.map((durationSec) => ({ durationSec, epochMs: nowMs + durationSec * 1000 }));
}

/**
 * Snaps a chosen absolute expiry time back to the offered duration that lands
 * closest to it, so TIME mode always submits a valid duration. Clamped to the
 * offered range: a time in the past (or nearer than the shortest duration)
 * maps to the shortest; one beyond the longest maps to the longest. Always
 * returns a member of `durations`.
 */
export function durationForTargetTime(
  nowMs: number,
  targetMs: number,
  durations: readonly number[] = DURATIONS_SEC,
): number {
  const desiredSec = (targetMs - nowMs) / 1000;
  let best = durations[0]!;
  let bestGap = Math.abs(best - desiredSec);
  for (const d of durations) {
    const gap = Math.abs(d - desiredSec);
    if (gap < bestGap) {
      best = d;
      bestGap = gap;
    }
  }
  return best;
}
