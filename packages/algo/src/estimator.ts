import { WEIGHT_CAP, WEIGHT_FLOOR, WEIGHT_REFERENCE_FLOOR } from "./constants";
import type { WindowEntry } from "./types";

/**
 * A trade's influence on the posterior, normalised against the account's own
 * median stake and bounded at both ends.
 *
 * The floor (0.1) is the anti-farming control: a hundred one-rupee trades count
 * for ten, not a hundred, so an attacker cannot cheaply drag their posterior
 * down before a large bet. The reference is floored at 1,000 minor units to
 * resist median manipulation (farming the median to shrink the reference stake).
 * The cap stops one outsized trade swamping history.
 */
export function tradeWeight(stake: number, medianStake: number): number {
  const reference = Math.max(medianStake, WEIGHT_REFERENCE_FLOOR);
  const raw = stake / reference;
  if (raw < WEIGHT_FLOOR) return WEIGHT_FLOOR;
  if (raw > WEIGHT_CAP) return WEIGHT_CAP;
  return raw;
}

/**
 * Beta-Binomial posterior with the prior centred on the target.
 *
 * With an empty window this returns the target exactly, so the controller
 * error is zero and no manipulation occurs until there is evidence. There is
 * no threshold to tune and no special case to forget.
 */
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
