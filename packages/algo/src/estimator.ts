import { WEIGHT_CAP, WEIGHT_FLOOR } from "./constants";
import type { WindowEntry } from "./types";

export function tradeWeight(stake: number, medianStake: number): number {
  const reference = medianStake > 0 ? medianStake : 1;
  const raw = stake / reference;
  if (raw < WEIGHT_FLOOR) return WEIGHT_FLOOR;
  if (raw > WEIGHT_CAP) return WEIGHT_CAP;
  return raw;
}

export function posteriorFromTotals(
  wonWeight: number,
  totalWeight: number,
  target: number,
  priorStrength: number,
): number {
  return (wonWeight + target * priorStrength) / (totalWeight + priorStrength);
}

export function posterior(
  window: readonly WindowEntry[],
  target: number,
  priorStrength: number,
): number {
  let wonWeight = 0;
  let totalWeight = 0;
  for (const entry of window) {
    totalWeight += entry.weight;
    if (entry.won) wonWeight += entry.weight;
  }
  return posteriorFromTotals(wonWeight, totalWeight, target, priorStrength);
}
