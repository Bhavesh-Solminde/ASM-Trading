/** Minimum touch target (pt). */
export const MIN_TOUCH = 44;

/** Vertical hitSlop that lifts a pill shorter than 44pt up to a 44pt target. */
export function chipHitSlop(height: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH - height) / 2));
}
