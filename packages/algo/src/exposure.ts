import type { Position } from "@asm/trading";
import {
  BIAS_SIGMA_CAP,
  EXPOSURE_FLOOR,
  EXPOSURE_FULL,
  IMBALANCE_TAU_SEC,
  WHALE_CAP_FRACTION,
} from "./constants";

export function totalExposure(positions: readonly Position[]): number {
  let sum = 0;
  for (const position of positions) {
    sum += (position.stake * position.payoutPct) / 100;
  }
  return sum;
}

/**
 * Returns a signed value in [-1, 1] measuring which side of the book has more
 * money at stake:
 *   > 0  → the book is net LONG (more UP liability) — the house wants price
 *          down, so driftBias will pull the chart down and the UP side loses.
 *   < 0  → the book is net SHORT — driftBias pulls chart up, DOWN side loses.
 *   = 0  → balanced (or empty book), no manipulation.
 *
 * Weighting per position:
 *   liability   = stake × payoutPct / 100 (the ₹ the house would pay on a win)
 *   time decay  = exp(-secondsToExpiry / IMBALANCE_TAU_SEC) — a trade about to
 *                 expire matters more than one expiring in 10 minutes.
 *   whale cap   = each position's contribution is capped at
 *                 WHALE_CAP_FRACTION × sum of raw weights, so a single ₹10 lakh
 *                 bet cannot override the direction of 99 ₹100 bets going the
 *                 other way.
 *
 * The cap is applied to the NUMERATOR only. The denominator uses uncapped
 * weights, so the value stays in [-1, 1] and a lone whale in a large book
 * produces a smaller imbalance (correct: the whale is diluted) rather than
 * saturating the ratio.
 */
export function imbalance(
  positions: readonly Position[],
  nowSec: number,
): number {
  // Pass 1: compute each position's raw weight and the per-side totals.
  const weights: number[] = new Array(positions.length);
  let upWeight = 0;
  let downWeight = 0;
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i]!;
    const liability = (position.stake * position.payoutPct) / 100;
    const secondsToExpiry = Math.max(0, position.expirySec - nowSec);
    const decay = Math.exp(-secondsToExpiry / IMBALANCE_TAU_SEC);
    const weight = liability * decay;
    weights[i] = weight;
    if (position.direction === "UP") upWeight += weight;
    else downWeight += weight;
  }

  const weightSum = upWeight + downWeight;
  if (weightSum === 0) return 0;

  // Short-circuit for one-sided books: the whole cap idea is "dilute a whale
  // against the OPPOSING crowd." A book with no opposition can't be diluted
  // by a phantom crowd, and returning anything less than ±1 here would
  // silently down-weight cases where the house's manipulation should be at
  // its strongest.
  if (upWeight === 0) return -1;
  if (downWeight === 0) return 1;

  // Pass 2: opposition exists — apply the per-position whale cap to the
  // DIRECTIONAL pressure. The denominator stays uncapped so the range
  // remains [-1, 1] and a lone whale registers as a smaller imbalance
  // rather than a false-positive full saturation.
  const perPositionCap = weightSum * WHALE_CAP_FRACTION;
  let pressure = 0;
  for (let i = 0; i < positions.length; i++) {
    const cappedWeight = Math.min(weights[i]!, perPositionCap);
    const wantsDown = positions[i]!.direction === "UP" ? 1 : -1;
    pressure += cappedWeight * wantsDown;
  }

  return pressure / weightSum;
}

export function exposureScale(exposure: number): number {
  if (exposure < EXPOSURE_FLOOR) return 0;
  if (exposure >= EXPOSURE_FULL) return 1;
  return (exposure - EXPOSURE_FLOOR) / (EXPOSURE_FULL - EXPOSURE_FLOOR);
}

export function driftBias(input: {
  imbalance: number;
  exposure: number;
  sigma: number;
}): number {
  const scale = exposureScale(input.exposure);
  if (scale === 0) return 0;

  const raw = -BIAS_SIGMA_CAP * input.imbalance * input.sigma * scale;
  const cap = BIAS_SIGMA_CAP * input.sigma;
  return raw > cap ? cap : raw < -cap ? -cap : raw;
}

export function expiryMagnet(input: {
  currentPrice: number;
  targetPrice: number;
  secondsLeft: number;
  convergenceWindowSec: number;
  sigma: number;
}): number {
  if (input.secondsLeft > input.convergenceWindowSec) return 0;
  if (input.currentPrice <= 0 || input.targetPrice <= 0) return 0;

  const progress = 1 - input.secondsLeft / input.convergenceWindowSec;
  const urgency = Math.min(1, Math.max(0, progress)) ** 2;

  const gap = Math.log(input.targetPrice / input.currentPrice);
  const pull = urgency * gap;

  const cap = 2 * input.sigma;
  return pull > cap ? cap : pull < -cap ? -cap : pull;
}
