/**
 * One frame of an exponential ease toward a target. `k` is the fraction of the
 * remaining distance covered this frame (0 < k <= 1): small k glides slowly,
 * k = 1 snaps. When the remaining distance is within `epsilon` the value snaps
 * to the target so it settles cleanly instead of creeping forever.
 *
 * Used to drift the displayed last price between engine ticks so the price line
 * and the forming candle's close move smoothly rather than jumping.
 */
export function stepEase(current: number, target: number, k: number, epsilon = 0): number {
  if (Math.abs(target - current) <= epsilon) return target;
  const next = current + (target - current) * k;
  return Math.abs(target - next) <= epsilon ? target : next;
}
