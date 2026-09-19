import type { Position } from "@asm/trading";
import {
  BIAS_SIGMA_CAP,
  EXPOSURE_FLOOR,
  EXPOSURE_FULL,
  IMBALANCE_TAU_SEC,
} from "./constants";

export function totalExposure(positions: readonly Position[]): number {
  let sum = 0;
  for (const position of positions) {
    sum += (position.stake * position.payoutPct) / 100;
  }
  return sum;
}

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

    const wantsDown = position.direction === "UP" ? 1 : -1;
    pressure += weight * wantsDown;
    weightSum += weight;
  }

  if (weightSum === 0) return 0;
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
