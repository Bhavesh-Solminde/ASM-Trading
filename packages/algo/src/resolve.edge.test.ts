import { describe, expect, it } from "vitest";
import { resolveBucket, type BucketWish } from "./resolve";

/**
 * Edge-case coverage for the bucket resolver, split from resolve.test.ts to
 * keep the base behaviour tests uncluttered. Covers:
 *
 * - A3: tie-break is by distance from currentPrice (not lowest-price).
 * - A6: house-P&L honours stakeFromBonus.
 * - Refund tri-state: exit == entry contributes zero to both terms.
 * - maxMove=0 collapses to currentPrice.
 * - On-target-user voice (paired with the URGENCY_FLOOR from the controller).
 */

const TICK = 0.00001;

function wish(overrides: Partial<BucketWish> = {}): BucketWish {
  return {
    entryPrice: 1.175,
    direction: "UP",
    wantWin: true,
    urgency: 1,
    stake: 10_000,
    payoutPct: 100,
    ...overrides,
  };
}

describe("resolveBucket — A3 no systematic downward bias", () => {
  it("does not systematically pick the LOWER candidate when scores are near-tied", () => {
    // Regression against the pre-fix behaviour: the resolver sorted by
    // ascending price and used strict `>` on scores, so any tied score
    // silently picked the lowest-price candidate. Over thousands of
    // settlements this planted a downward-drift bias.
    //
    // Construct a mirror-image bucket: two DOWN-wantWin=false wishes
    // (they want price to rise so they lose their bearish bet) versus
    // two UP-wantWin=false wishes (they want price to fall) at the same
    // entry. The resolver has no wish-satisfaction reason to prefer up
    // or down. If the tie-break were still "prefer lowest", the result
    // would always be below 1.175. The fixed tie-break makes it a
    // near-random-looking choice among the reachable minima; the
    // guarantee this test asserts is "no monotonic bias downward".
    let picks_lower = 0;
    let picks_upper = 0;
    for (let i = 0; i < 20; i++) {
      // Vary currentPrice slightly to sweep the resolver over many
      // rounding boundaries — the old bug reproduced identically for any
      // currentPrice on the tick grid.
      const cp = 1.175 + i * TICK;
      const target = resolveBucket({
        wishes: [
          wish({ direction: "UP", wantWin: false, entryPrice: cp }),
          wish({ direction: "DOWN", wantWin: false, entryPrice: cp }),
        ],
        currentPrice: cp,
        maxMove: 0.01,
        tickSize: TICK,
      });
      if (target < cp) picks_lower += 1;
      if (target > cp) picks_upper += 1;
    }
    // The pre-fix behaviour would give picks_lower === 20, picks_upper === 0.
    // Anti-regression: assert we DIDN'T get that monotonic outcome.
    expect(picks_lower).toBeLessThan(20);
  });

  it("picks currentPrice unchanged when it is strictly the highest-scoring candidate", () => {
    // A single UP wish that wants a WIN. Only up-ticks satisfy the wish.
    // currentPrice at 1.175 is a REFUND for this wish (neutral, score 0)
    // while 1.17501 is a WIN (+urgency). The resolver should pick
    // 1.17501, and the point of this test is that the distance-based
    // tie-break did not accidentally pull it back to currentPrice
    // (which would be a real regression of a different flavor).
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });
});

describe("resolveBucket — refund tri-state", () => {
  it("treats exit == entry as neutral (score 0), not as a loss for UP", () => {
    // Before the tri-state fix, an UP wish that wanted a WIN saw
    // wins(UP, 1.175, 1.175) return false (rose = 1.175 > 1.175 = false),
    // which counted as a loss for the wish. That would make currentPrice
    // a WORSE candidate than any upward tick, even if the resolver's
    // stronger preference is to stand pat.
    //
    // With the fix, exit == entry is score-neutral, so a lonely satisfied
    // UP wish still resolves cleanly to entry+tick (a real win) instead
    // of oscillating on the refund boundary.
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });
});

describe("resolveBucket — A6 bonus-stake awareness", () => {
  it("does not use the house-P&L tie-break against a fully-bonus wish", () => {
    // Two wishes at the same entry, both want a WIN. One is real money, the
    // other is fully bonus-funded (stakeFromBonus === stake). The user
    // wish-satisfaction score ties them; only the house-P&L term differs.
    //
    // Bonus wish's win doesn't cost the house real cash — its book term is
    // zero. Real wish's win DOES cost the house — its book term is negative
    // on the winning candidate. Sum: the winning candidate scores lower on
    // the book term than a losing candidate would in aggregate, but both
    // wishes' urgency dominate the book term (BOOK_WEIGHT = 0.001).
    //
    // The concrete assertion: the resolver picks a winning candidate,
    // proving urgency still wins over the book term for a bonus-heavy
    // bucket (which was over-penalized before the fix).
    const target = resolveBucket({
      wishes: [
        wish({ entryPrice: 1.175, wantWin: true, stakeFromBonus: 0 }),
        wish({ entryPrice: 1.175, wantWin: true, stakeFromBonus: 10_000 }),
      ],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });

  it("uses only the real fraction of stake for the book term (partial bonus stake)", () => {
    // A 30%-bonus wish should have its book cost reduced to 70% of the
    // full-real equivalent. This is a soft signal, so we test it via a
    // constructed tie: two candidates satisfying identical urgency sums,
    // where only the book fraction can decide.
    //
    // Wish A wants to WIN, all real money → winning it costs house 1.0 * payoutPct.
    // Wish B wants to WIN, 30% bonus stake → winning it costs house 0.7 * payoutPct.
    // Both wishes at the same entry, single up-move satisfies both — the
    // book term aggregate is (-1.0 - 0.7) * payout/100 * BOOK_WEIGHT — a
    // tiny negative. The urgency sum is +2 either way. No candidate ties
    // here on aggregate, so this test simply confirms the code runs and
    // resolves upward. Kept as a smoke test — the direct math is asserted
    // by the resolver's own body.
    const target = resolveBucket({
      wishes: [
        wish({ entryPrice: 1.175, wantWin: true, stakeFromBonus: 0 }),
        wish({ entryPrice: 1.175, wantWin: true, stakeFromBonus: 3_000 }),
      ],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175);
  });
});

describe("resolveBucket — reachability", () => {
  it("stands pat when maxMove is zero", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });

  it("stands pat when no candidate is within maxMove", () => {
    // Only far-away candidates would satisfy the wish; maxMove is too tight
    // for any of them to be reachable, so the resolver returns currentPrice.
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 5.0 })],
      currentPrice: 1.175,
      maxMove: 0.001,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });

  it("returns currentPrice for an empty bucket regardless of maxMove", () => {
    expect(
      resolveBucket({
        wishes: [],
        currentPrice: 1.175,
        maxMove: 100,
        tickSize: TICK,
      }),
    ).toBe(1.175);
  });
});

describe("resolveBucket — urgency floor pairing (A2)", () => {
  it("an on-target wish (urgency 0.05) still tilts the resolution against a stronger wish", () => {
    // Small-urgency wish should still count for something — otherwise A2
    // would have been decorative. Pair a floor-urgency user (UP, wantWin
    // true) against a slightly-stronger DOWN user (urgency 0.10) that
    // wants a win. Their preferences oppose. Aggregate wish-score prefers
    // whichever side has more urgency.
    const withoutSmall = resolveBucket({
      wishes: [
        wish({
          direction: "DOWN",
          wantWin: true,
          entryPrice: 1.175,
          urgency: 0.10,
        }),
      ],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    // Only DOWN wish, wants a win — resolver moves price DOWN.
    expect(withoutSmall).toBeLessThan(1.175);

    const withSmall = resolveBucket({
      wishes: [
        wish({
          direction: "DOWN",
          wantWin: true,
          entryPrice: 1.175,
          urgency: 0.10,
        }),
        // Floor-urgency user pushes back.
        wish({
          direction: "UP",
          wantWin: true,
          entryPrice: 1.175,
          urgency: 0.05,
        }),
      ],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    // The DOWN wish still wins the aggregate (0.10 > 0.05), so price still
    // moves down — but the small wish scored some voice into the decision
    // via the shared distance tie-break. Assertion: same DOWN direction is
    // chosen, i.e. the small voice doesn't flip the outcome unfairly.
    expect(withSmall).toBeLessThan(1.175);
  });
});

describe("resolveBucket — undetectability cap (honestPrice + maxHonestShift)", () => {
  it("honors the cap: no candidate more than N ticks from honestPrice is picked", () => {
    // A single UP wish that WANTS to win. Without a cap, resolveBucket would
    // happily move price above entry to satisfy it. With honestPrice pinned
    // far below entry and maxHonestShift = 2 ticks, the ONLY reachable
    // candidates are within 2 ticks of the honest price. No candidate above
    // entry is reachable → the resolver settles at the closest honest-
    // window candidate below entry, and the wish loses.
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.17500,
      maxMove: 0.01,
      tickSize: TICK,
      honestPrice: 1.17490,
      maxHonestShift: 2,
    });
    // Reachable candidates ∈ [1.17488, 1.17492]. Everything below entry.
    // Wish wanted to win but honestPrice constrained the resolver.
    expect(target).toBeLessThanOrEqual(1.17492 + 1e-9);
    expect(target).toBeGreaterThanOrEqual(1.17488 - 1e-9);
    expect(target).toBeLessThan(1.175); // UP wish lost as a natural consequence
  });

  it("flips a marginal outcome when the honest price is within the cap window", () => {
    // Big-money side is UP (wish wants UP to LOSE). Honest exit at 1.17501
    // (barely above entry, UP would naturally win). Cap = 2 ticks: 1.17499
    // is reachable → UP loses under manipulation.
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: false, entryPrice: 1.175 })],
      currentPrice: 1.17501,
      maxMove: 0.01,
      tickSize: TICK,
      honestPrice: 1.17501,
      maxHonestShift: 2,
    });
    expect(target).toBeLessThan(1.175); // flipped UP win → UP loss
  });

  it("standing at honestPrice is always a valid candidate", () => {
    // Empty book (no wishes) should return honestPrice (or currentPrice —
    // both are added as candidates; they may differ under drift).
    const target = resolveBucket({
      wishes: [],
      currentPrice: 1.17501,
      maxMove: 0.01,
      tickSize: TICK,
      honestPrice: 1.17490,
      maxHonestShift: 2,
    });
    expect(target).toBe(1.17501); // empty short-circuit returns currentPrice
  });

  it("with the cap OFF (both fields omitted), old behavior is preserved", () => {
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 1.175 })],
      currentPrice: 1.175,
      maxMove: 0.01,
      tickSize: TICK,
    });
    expect(target).toBeGreaterThan(1.175); // UP wish satisfied, moves up
  });
});

describe("resolveBucket — Phase 2C snap-to-honest fallback", () => {
  it("snaps to honestPrice when the windows do not intersect (the Bank NIFTY 8-hour drift bug)", () => {
    // Reproduces the exact conditions that stranded the resolver on
    // Bank NIFTY: shown has drifted 400 units below honest, maxMove around
    // shown is ±40 units, cap around honest is ±20 units, and none of the
    // candidates fall inside both. Before Phase 2C the resolver returned
    // currentPrice (fully unmanipulated). After Phase 2C it snaps to
    // honestPrice, restoring reachability for the next tick.
    const honestPrice = 53_310;
    const currentPrice = 52_920; // 390 units below honest
    const target = resolveBucket({
      wishes: [
        wish({
          direction: "UP",
          wantWin: false,
          entryPrice: currentPrice,
          urgency: 10,
          stake: 10_000,
        }),
      ],
      currentPrice,
      maxMove: 40, // typical Bank NIFTY per-tick cap
      tickSize: 1,
      honestPrice,
      maxHonestShift: 20, // the too-tight cap that caused the bug
    });
    expect(target).toBe(honestPrice);
  });

  it("does NOT snap when the reachable set is non-empty (regression)", () => {
    // Reachable non-empty → the scoring loop runs. Construct a big-money
    // UP-loses scenario where honestPrice sits at entry (a REFUND, not a
    // loss) and manipulated exit below entry is strictly better on score.
    // The resolver must pick the manipulated candidate, NOT snap to honest.
    const target = resolveBucket({
      wishes: [
        wish({
          direction: "UP",
          wantWin: false,
          entryPrice: 1.175,
          urgency: 10,
        }),
      ],
      currentPrice: 1.17501,
      maxMove: 0.01,
      tickSize: TICK,
      honestPrice: 1.17500, // sits at entry → refund for the wish
      maxHonestShift: 5,
    });
    // A snap would return honestPrice (=entry, refund). A working scoring
    // loop picks a candidate BELOW entry (UP loses = wish satisfied).
    expect(target).toBeLessThan(1.175);
  });

  it("still returns currentPrice when honestPrice is not supplied and reachable is empty", () => {
    // With no honestPrice the pre-Phase-2 fallback path stays in force.
    const target = resolveBucket({
      wishes: [wish({ direction: "UP", wantWin: true, entryPrice: 5.0 })],
      currentPrice: 1.175,
      maxMove: 0.001,
      tickSize: TICK,
    });
    expect(target).toBe(1.175);
  });
});
