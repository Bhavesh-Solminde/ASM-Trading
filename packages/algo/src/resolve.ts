import type { Direction } from "@asm/trading";
import { BOOK_WEIGHT } from "./constants";

export interface BucketWish {
  readonly entryPrice: number;
  readonly direction: Direction;
  readonly wantWin: boolean;
  readonly urgency: number;
  readonly stake: number;
  readonly payoutPct: number;
}

function wins(direction: Direction, entryPrice: number, price: number): boolean {
  const rose = price > entryPrice;
  return direction === "UP" ? rose : !rose;
}

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

  let best = reachable[0]!;
  let bestScore = -Infinity;

  for (const candidate of reachable) {
    let score = 0;

    for (const w of wishes) {
      const won = wins(w.direction, w.entryPrice, candidate);
      score += won === w.wantWin ? w.urgency : -w.urgency;

      // House P&L as a fraction of stake, not the raw currency amount — this
      // keeps the tie-break commensurate with urgency (both dimensionless)
      // regardless of how large an individual wish's stake is.
      const housePnlFraction = won ? -(w.payoutPct / 100) : 1;
      score += BOOK_WEIGHT * housePnlFraction;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
