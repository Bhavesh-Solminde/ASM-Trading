import { MAGNET_CAP, MAGNET_WINDOW_SEC, TARGET_MARGIN_SIGMA } from "./constants";

/**
 * Layer 3. Quadratic urgency — near-invisible early, decisive late.
 *
 * Only fires within MAGNET_WINDOW_SEC of expiry. Capped at MAGNET_CAP × sigmaTick
 * so re-convergence hides inside normal movement.
 *
 * sigmaTick is the per-tick standard deviation.
 */
export function expiryMagnet(input: {
  currentPrice: number;
  targetPrice: number;
  secondsLeft: number;
  sigmaTick: number;
}): number {
  if (input.secondsLeft > MAGNET_WINDOW_SEC) return 0;
  if (input.currentPrice <= 0 || input.targetPrice <= 0) return 0;
  if (Math.abs(input.currentPrice - input.targetPrice) < 1e-12) return 0;

  const progress = 1 - input.secondsLeft / MAGNET_WINDOW_SEC;
  const urgency = Math.min(1, Math.max(0, progress)) ** 2;

  const gap = Math.log(input.targetPrice / input.currentPrice);
  const pull = urgency * gap;

  const cap = MAGNET_CAP * input.sigmaTick;
  return pull > cap ? cap : pull < -cap ? -cap : pull;
}

/**
 * How far (in price units) the price could plausibly reach in the remaining
 * ticks, measured in log-price space then converted.
 *
 * Used by the engine to choose between the layer-3 target and standing pat.
 */
export function reachableMove(input: {
  price: number;
  sigmaTick: number;
  secondsLeft: number;
  dtSec: number;
}): number {
  const ticks = Math.max(0, input.secondsLeft / input.dtSec);
  // 3-sigma reach in log-space, converted to absolute price move
  return input.price * (Math.exp(3 * input.sigmaTick * Math.sqrt(ticks)) - 1);
}

/**
 * Minimum gap past an entry price that constitutes a clear win or loss.
 *
 * The engine places the target at this distance so there is no ambiguity
 * from rounding: TARGET_MARGIN_SIGMA ticks of typical movement.
 */
export function targetMargin(input: {
  price: number;
  sigmaTick: number;
  tickSize: number;
}): number {
  const marginInPrice = TARGET_MARGIN_SIGMA * input.sigmaTick * input.price;
  // At least one tickSize, rounded up to the nearest tick
  const ticks = Math.max(1, Math.ceil(marginInPrice / input.tickSize));
  return ticks * input.tickSize;
}
