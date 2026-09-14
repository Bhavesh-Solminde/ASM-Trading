import type { Position } from "@asm/trading";

/**
 * The bots' only visible output.
 *
 * Stake-weighted rather than head-counted, so it agrees with the imbalance the
 * (future) controller would act on — a bar showing 60% up while the book is
 * actually short-heavy by stake would be incoherent.
 *
 * Falls back to an even split for an empty book rather than 0/0.
 */
export function computeSentiment(positions: readonly Position[]): {
  upPct: number;
  downPct: number;
} {
  let up = 0;
  let total = 0;

  for (const position of positions) {
    total += position.stake;
    if (position.direction === "UP") up += position.stake;
  }

  if (total === 0) return { upPct: 50, downPct: 50 };

  const upPct = Math.round((up / total) * 100);
  return { upPct, downPct: 100 - upPct };
}
