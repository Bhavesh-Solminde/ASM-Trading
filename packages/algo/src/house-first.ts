import type { Position } from "@asm/trading";
import type { BucketWish } from "./resolve";

/**
 * House-first mode. Deterministic per-bucket wishes derived purely from the
 * aggregate money at stake — no per-user history, no probability draw. Whichever
 * side has more real-money liability loses on every bucket. Every rupee counts
 * (no exposure floor, no whale cap), matching the design in algorithm.md.
 *
 * The returned wishes plug directly into `resolveBucket`, which combines them
 * with the tick-level `MAX_HONEST_TICK_SHIFT` cap to pick an exit price. High
 * urgency (10.0) ensures the resolver's wish-satisfaction term dominates the
 * BOOK_WEIGHT tie-breaker, so the outcome is fully determined by which side
 * has more money — never by the internal book-cost heuristic.
 *
 * Bonus-portion stakes count only at their REAL fraction (Q3 in algorithm.md).
 * A pure-bonus stake carries zero book cost on a win — including it at full
 * value would over-count the liability and could flip direction against the
 * side that actually has more of the house's real money on the hook.
 */

const HOUSE_URGENCY = 10.0;

export interface HouseFirstOutcome {
  /** Wishes to pass to `resolveBucket`, one per input position, order preserved. */
  readonly wishes: BucketWish[];
  /** The side the algorithm chose to lose. `null` when the book has no positions. */
  readonly losingDirection: "UP" | "DOWN" | null;
  /** Total real-money liability on the UP side. */
  readonly upLiability: number;
  /** Total real-money liability on the DOWN side. */
  readonly downLiability: number;
  /** True when the two sides were exactly equal and a coin flip decided direction. */
  readonly tieBroken: boolean;
}

/**
 * Deterministic pseudo-random for the tie-break case, seeded from the bucket
 * identity so audits can replay it. Same `(assetId, expirySec)` always yields
 * the same coin flip. Fair from the users' perspective because they cannot
 * predict which coin they got, but reproducible for review.
 *
 * Uses a fixed hash mix, not `Math.random()`, so the tie-break is
 * deterministic across runs and machines.
 */
function tieBreakCoin(seed: string): "UP" | "DOWN" {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0; // djb2
  }
  return (hash & 1) === 0 ? "UP" : "DOWN";
}

/**
 * Computes wishes for one bucket under house-first mode.
 *
 * `positions` — every open trade in the bucket (same asset, same expiry second).
 * `tieBreakSeed` — a string used only when `upLiability === downLiability`.
 *                  Recommended: `${assetId}|${expirySec}`.
 */
export function houseFirstWishes(
  positions: readonly Position[],
  tieBreakSeed: string,
): HouseFirstOutcome {
  if (positions.length === 0) {
    return {
      wishes: [],
      losingDirection: null,
      upLiability: 0,
      downLiability: 0,
      tieBroken: false,
    };
  }

  let upLiability = 0;
  let downLiability = 0;
  for (const position of positions) {
    // Only the real portion of the stake carries a house liability on a win.
    // Bonus wins settle back to the sticky bonus balance — no real cash leaves
    // the platform. See A6 in the previous algo pass; the same principle
    // applies to the aggregate house-first calculation.
    const bonusPortion = readBonusPortion(position);
    const realFraction =
      position.stake > 0
        ? Math.max(0, position.stake - bonusPortion) / position.stake
        : 1;
    const liability = ((position.stake * position.payoutPct) / 100) * realFraction;
    if (position.direction === "UP") upLiability += liability;
    else downLiability += liability;
  }

  let losingDirection: "UP" | "DOWN";
  let tieBroken = false;
  if (upLiability > downLiability) {
    losingDirection = "UP";
  } else if (downLiability > upLiability) {
    losingDirection = "DOWN";
  } else {
    // Exact tie. Coin flip decides which side loses. `payoutPct` × `realFraction`
    // makes exact float ties possible but rare; when they happen we hand the
    // decision to the tie-break coin rather than falling back to the resolver's
    // BOOK_WEIGHT heuristic (which would silently favor whichever side happens
    // to have more real-fraction).
    losingDirection = tieBreakCoin(tieBreakSeed);
    tieBroken = true;
  }

  const wishes: BucketWish[] = positions.map((position) => {
    const wish: BucketWish = {
      entryPrice: position.entryPrice,
      direction: position.direction,
      wantWin: position.direction !== losingDirection,
      urgency: HOUSE_URGENCY,
      stake: position.stake,
      payoutPct: position.payoutPct,
    };
    const bonus = readBonusPortion(position);
    if (bonus > 0) {
      return { ...wish, stakeFromBonus: bonus };
    }
    return wish;
  });

  return { wishes, losingDirection, upLiability, downLiability, tieBroken };
}

/**
 * `Position` was designed before bonus tracking existed at this layer — the
 * value is present on the `Trade` row but the in-memory `Position` type does
 * not expose it. Rather than widening the shared type, this helper reads the
 * optional field defensively and defaults to 0 for callers that never fill
 * it (older code paths, tests that don't care about bonus math).
 */
function readBonusPortion(position: Position): number {
  const bonusField = (position as unknown as { stakeFromBonus?: number })
    .stakeFromBonus;
  return typeof bonusField === "number" && bonusField > 0 ? bonusField : 0;
}
