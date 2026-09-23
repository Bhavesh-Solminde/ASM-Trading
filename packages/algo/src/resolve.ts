import type { Direction } from "@asm/trading";
import { BOOK_WEIGHT } from "./constants";

export interface BucketWish {
  readonly entryPrice: number;
  readonly direction: Direction;
  readonly wantWin: boolean;
  readonly urgency: number;
  readonly stake: number;
  readonly payoutPct: number;
  /**
   * The portion of `stake` drawn from the sticky bonus balance. Optional —
   * older callers pass nothing, which behaves as 0 (all real money).
   *
   * When a wish is fully or partly bonus-funded, a win on it doesn't cost the
   * house real cash: bonus payouts credit the sticky bonus balance and stay
   * inside the system. The house-P&L tie-breaker uses this to avoid over-
   * penalizing bonus-heavy players — a full-bonus stake carries no book cost
   * on a win, so the resolver is free to favour the user's own preference on
   * ties instead.
   */
  readonly stakeFromBonus?: number;
}

/**
 * Tri-state outcome, mirroring `didWin` in packages/trading:
 *   true  → wish wins
 *   false → wish loses
 *   null  → exact tie → the trade will REFUND
 *
 * Before this the resolver treated `price === entryPrice` as a loss for UP
 * (and a win for DOWN), which quietly disagreed with settlement's own tie-
 * is-refund rule. A resolver that picked `currentPrice` thinking a wish would
 * "lose" there was actually picking a refund the wish never asked for.
 */
function outcome(
  direction: Direction,
  entryPrice: number,
  price: number,
): boolean | null {
  if (price === entryPrice) return null;
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

  // Ties on `bestScore` used to be broken by whichever candidate the sorted
  // pass hit first (ascending by price), which planted a subtle systematic
  // downward pull whenever wishes cancelled out. Sorting by distance from
  // `currentPrice` instead breaks ties toward the smaller, more honest move
  // — no directional preference, and the natural "stand pat" price
  // (currentPrice itself) wins whenever no wish has cause to overrule it.
  const reachable = [...candidates]
    .filter((c) => c > 0 && Math.abs(c - currentPrice) <= maxMove)
    .sort((a, b) => Math.abs(a - currentPrice) - Math.abs(b - currentPrice));

  if (reachable.length === 0) return currentPrice;

  let best = reachable[0]!;
  let bestScore = -Infinity;

  for (const candidate of reachable) {
    let score = 0;

    for (const w of wishes) {
      const won = outcome(w.direction, w.entryPrice, candidate);

      // Refund is neither the user's wish nor its opposite — score-neutral
      // for the wish-satisfaction term, and house-neutral for the book term
      // (the stake goes back where it came from, no money moves).
      if (won === null) continue;

      score += won === w.wantWin ? w.urgency : -w.urgency;

      // House P&L as a fraction of stake, not raw currency, so the tie-break
      // is commensurate with urgency (both dimensionless) regardless of an
      // individual wish's stake size.
      //
      // Only the REAL portion of the stake carries a house cost on a win —
      // bonus wins credit the sticky bonus balance and never leave the system.
      // Missing `stakeFromBonus` defaults to 0 (all real), which recovers the
      // pre-2026-09-23 behavior for callers that predate this field.
      const bonusPortion = w.stakeFromBonus ?? 0;
      const realFraction =
        w.stake > 0 ? Math.max(0, w.stake - bonusPortion) / w.stake : 1;
      const housePnlFraction = won ? -(w.payoutPct / 100) * realFraction : 1;
      score += BOOK_WEIGHT * housePnlFraction;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
