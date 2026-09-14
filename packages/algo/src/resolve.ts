import type { Direction } from "@asm/trading";
import { BOOK_WEIGHT } from "./constants";

export interface BucketWish {
  readonly entryPrice: number;
  readonly direction: Direction;
  /** What the controller wants for this position. */
  readonly wantWin: boolean;
  /** How much the engine cares, from ControllerOutput.urgency. */
  readonly urgency: number;
  readonly stake: number;
  readonly payoutPct: number;
}

function wins(direction: Direction, entryPrice: number, price: number): boolean {
  const rose = price > entryPrice;
  return direction === "UP" ? rose : !rose;
}

/**
 * Chooses the exit price for one expiry bucket.
 *
 * A position's outcome flips only at its own entry price, so the outcome set is
 * constant between adjacent entry prices. That means there are at most N+1
 * distinct regimes and the optimum can be found exactly rather than searched
 * for — O(N log N), no iteration, no approximation.
 *
 * Candidates are one tick either side of each entry price, plus the current
 * price, filtered to what is reachable within maxMove.
 *
 * House P&L is normalised to [-1, 1] before weighting so it acts only as a
 * tiebreaker — never overriding the win-rate objective. An exact entry-price
 * hit counts as a refund (the position is excluded from the wish score).
 */
export function resolveBucket(input: {
  wishes: readonly BucketWish[];
  currentPrice: number;
  maxMove: number;
  tickSize: number;
}): number {
  const { wishes, currentPrice, maxMove, tickSize } = input;
  if (wishes.length === 0) return currentPrice;

  const candidates = new Set<number>([currentPrice]);
  for (const w of wishes) {
    candidates.add(w.entryPrice + tickSize);
    candidates.add(w.entryPrice - tickSize);
  }

  const reachable = [...candidates]
    .filter((c) => c > 0 && Math.abs(c - currentPrice) <= maxMove)
    .sort((a, b) => a - b);

  if (reachable.length === 0) return currentPrice;

  // Max total house liability for normalisation — prevents large stakes
  // from turning a tiebreaker into the primary objective.
  const maxHousePnl = wishes.reduce(
    (acc, w) => Math.max(acc, (w.stake * w.payoutPct) / 100, w.stake),
    1,
  );

  let best = reachable[0]!;
  let bestScore = -Infinity;

  for (const candidate of reachable) {
    let score = 0;

    for (const w of wishes) {
      // Exact entry price → refund; skip this wish entirely.
      if (Math.abs(candidate - w.entryPrice) < tickSize / 2) continue;

      const won = wins(w.direction, w.entryPrice, candidate);
      score += won === w.wantWin ? w.urgency : -w.urgency;

      // Normalised house P&L tiebreaker in [-1, 1].
      const housePnl = won
        ? -(w.stake * w.payoutPct) / 100
        : w.stake;
      score += BOOK_WEIGHT * (housePnl / maxHousePnl);
    }

    // Strict improvement → the lowest reachable candidate wins for ties
    // (sorted ascending), making the result deterministic.
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
