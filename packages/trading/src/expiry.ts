/**
 * The whole second at which a position settles.
 *
 * The engine settles on the first tick whose whole second is at or past this
 * value, so rounding UP guarantees a trade never settles before its full
 * duration has elapsed. Rounding down would shave up to a second off every
 * trade — on a 5-second trade, a fifth of it.
 */
export function expirySecFor(expiryMs: number): number {
  return Math.ceil(expiryMs / 1000);
}
