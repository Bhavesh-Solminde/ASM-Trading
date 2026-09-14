import type { Position } from "@asm/trading";
import {
  BIAS_SIGMA_CAP,
  EXPOSURE_FLOOR,
  EXPOSURE_FULL,
  IMBALANCE_TAU_SEC,
} from "./constants";

/** What the house stands to pay out if every position wins. */
export function totalExposure(positions: readonly Position[]): number {
  let sum = 0;
  for (const position of positions) {
    sum += (position.stake * position.payoutPct) / 100;
  }
  return sum;
}

/**
 * Stake-weighted, time-decayed exposure imbalance in [-1, 1].
 *
 * Positive means the house profits from the price FALLING (the book is net
 * long). Weights by stake rather than head count: sixty traders at ₹10 is
 * ₹600 of liability while forty at ₹100 is ₹4,000.
 */
export function imbalance(
  positions: readonly Position[],
  nowSec: number,
): number {
  let pressure = 0;
  let weightSum = 0;

  for (const position of positions) {
    const liability = (position.stake * position.payoutPct) / 100;
    const secondsToExpiry = Math.max(0, position.expirySec - nowSec);
    const decay = Math.exp(-secondsToExpiry / IMBALANCE_TAU_SEC);
    const weight = liability * decay;

    // +1 when the house benefits from the price falling (position is UP).
    const wantsDown = position.direction === "UP" ? 1 : -1;
    pressure += weight * wantsDown;
    weightSum += weight;
  }

  if (weightSum === 0) return 0;
  return pressure / weightSum;
}

/**
 * Ramps bias strength with book size.
 *
 * Below the floor the price runs completely unbiased. This is the thin-book
 * guard: a ₹100 book is not worth defending, and a single small trade must
 * never move a market.
 */
export function exposureScale(exposure: number): number {
  if (exposure < EXPOSURE_FLOOR) return 0;
  if (exposure >= EXPOSURE_FULL) return 1;
  return (exposure - EXPOSURE_FLOOR) / (EXPOSURE_FULL - EXPOSURE_FLOOR);
}

/**
 * Layer 2. A small persistent nudge toward the profitable side, hard-bounded
 * inside natural noise.
 *
 * sigmaTick is the per-tick standard deviation (NOT per-second). The cap is in
 * per-tick sigma so the bias hides inside natural tick-to-tick movement.
 */
export function driftBias(input: {
  imbalance: number;
  exposure: number;
  sigmaTick: number;
}): number {
  const scale = exposureScale(input.exposure);
  if (scale === 0) return 0;

  const raw = -BIAS_SIGMA_CAP * input.imbalance * input.sigmaTick * scale;
  const cap = BIAS_SIGMA_CAP * input.sigmaTick;
  return raw > cap ? cap : raw < -cap ? -cap : raw;
}
