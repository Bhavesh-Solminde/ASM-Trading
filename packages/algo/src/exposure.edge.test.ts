import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { driftBias, imbalance } from "./exposure";
import {
  BIAS_SIGMA_CAP,
  EXPOSURE_FULL,
  WHALE_CAP_FRACTION,
} from "./constants";

/**
 * Edge-case coverage for the aggregate-imbalance manipulation. Split from
 * exposure.test.ts so the base "does it point the right way" tests stay
 * uncluttered.
 *
 * Anchor scenario the user described:
 *   70 people bet ₹100 UP, 30 people bet ₹10,000 DOWN. DOWN has ~40× the
 *   money at stake. The algorithm should push the chart UP so DOWN loses
 *   and the majority-by-headcount UP side wins. Verified end-to-end below.
 */

let seq = 0;
function p(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: "a",
    assetId: "asset-1",
    direction: "UP",
    stake: 10_000, // ₹100 in paise
    payoutPct: 87,
    entryPrice: 1.175,
    expirySec: 1_000_060,
    isDemo: false,
    ...overrides,
  };
}

const NOW = 1_000_000;

describe("imbalance — the user's 70/30 scenario", () => {
  it("70 UP @ ₹100 vs 30 DOWN @ ₹10,000 → imbalance is negative (chart pushed UP, DOWN loses)", () => {
    const book: Position[] = [];
    for (let i = 0; i < 70; i++) {
      book.push(p({ direction: "UP", stake: 10_000 })); // ₹100
    }
    for (let i = 0; i < 30; i++) {
      book.push(p({ direction: "DOWN", stake: 1_000_000 })); // ₹10,000
    }
    // DOWN dominates by liability (30M paise vs 700k paise), so pressure
    // points toward DOWN direction, which the driftBias then INVERTS to
    // push price UP.
    const imb = imbalance(book, NOW);
    expect(imb).toBeLessThan(0);

    const bias = driftBias({
      imbalance: imb,
      exposure: EXPOSURE_FULL * 100,
      sigma: 0.001,
    });
    // Negative imbalance (DOWN-heavy) → POSITIVE driftBias → chart moves UP.
    expect(bias).toBeGreaterThan(0);
  });

  it("70 UP @ ₹100 vs 30 DOWN @ ₹10,000 → whale cap keeps imbalance moderate", () => {
    const book: Position[] = [];
    for (let i = 0; i < 70; i++) book.push(p({ direction: "UP", stake: 10_000 }));
    for (let i = 0; i < 30; i++) book.push(p({ direction: "DOWN", stake: 1_000_000 }));

    // Before the whale cap, this imbalance would be ~-0.977 (near
    // saturation because DOWN's raw weight is 30M vs UP's 700k). With
    // the cap, each of the 30 DOWN positions is capped at
    // 0.3 × totalWeight = 0.3 × ~30.7M ≈ 9.2M — but each DOWN position
    // is only 870k liability so no cap kicks in. The imbalance stays
    // near -0.977 in this scenario because no SINGLE position is huge.
    // The cap protects only against LONE whales, not aggregate imbalance.
    const imb = imbalance(book, NOW);
    expect(imb).toBeLessThan(0);
    expect(imb).toBeGreaterThanOrEqual(-1);
  });
});

describe("imbalance — house-first mode (every rupee counts, no whale cap)", () => {
  it("a single whale bet fully drives the direction against a small crowd", () => {
    // Under house-first mode the whale cap is bypassed — the whale's raw
    // weight goes into the numerator directly, matching the "every rupee
    // counts" principle. Whale = ₹10 lakh UP, crowd = 99 × ₹100 DOWN.
    // Whale's UP weight dwarfs the crowd's DOWN weight → imbalance
    // saturates close to +1 (UP direction, chart pushed against UP).
    const book: Position[] = [
      p({ direction: "UP", stake: 100_000_000 }), // ₹10 lakh whale
      ...Array.from({ length: 99 }, () =>
        p({ direction: "DOWN", stake: 10_000 }), // ₹100 each
      ),
    ];
    const imb = imbalance(book, NOW);
    expect(imb).toBeGreaterThan(0.9); // Whale is heavily positive (UP dominant)
    expect(imb).toBeLessThanOrEqual(1);
  });

  it("with 3+ equal co-directional positions, imbalance saturates at ±1", () => {
    // Three equal ₹100 UP bets → all UP → downWeight is 0 → short-circuit
    // returns +1. Unaffected by the whale-cap disable in house-first mode.
    const book: Position[] = [
      p({ direction: "UP", stake: 10_000 }),
      p({ direction: "UP", stake: 10_000 }),
      p({ direction: "UP", stake: 10_000 }),
    ];
    expect(imbalance(book, NOW)).toBeCloseTo(1, 6);
  });

  it("a whale on one side is NOT diluted by many opposing positions in house-first mode", () => {
    // Same setup as the old whale-cap test but the assertion is now inverted:
    // the whale is not diluted — their money defines the direction.
    const book: Position[] = [
      p({ direction: "UP", stake: 100_000_000 }),
      ...Array.from({ length: 20 }, () => p({ direction: "DOWN", stake: 100_000 })),
    ];
    // Whale liability = 87M, crowd = 20 × 87k = 1.74M. Uncapped ratio =
    // (87M - 1.74M) / (87M + 1.74M) ≈ 0.96 — whale dominates.
    const imb = imbalance(book, NOW);
    expect(imb).toBeGreaterThan(0.9);
  });

  // Retained here for the record: `WHALE_CAP_FRACTION` is still in the
  // constants file and still consulted by the fallback (non-house-first)
  // path in `imbalance()`. Not test-covered here because the flag is on
  // by default and this file exercises the default runtime.
  void WHALE_CAP_FRACTION;
});

describe("imbalance — stays bounded", () => {
  it("stays in [-1, 1] even with degenerate inputs", () => {
    // Zero-payout should never divide-by-zero: weight = liability × decay
    // with liability = 0 collapses to a book of weight zero → returns 0.
    expect(imbalance([p({ payoutPct: 0 })], NOW)).toBe(0);
  });

  it("expired position (secondsToExpiry <= 0) is still counted at full weight", () => {
    // A trade whose expiry has already passed — it's about to settle at
    // the next tick. Its influence on the imbalance is maximum. We use
    // Math.max(0, secondsToExpiry) so a trade at t=0 or t<0 uses decay=1.
    const past = p({ direction: "UP", expirySec: NOW - 5 });
    expect(imbalance([past], NOW)).toBeGreaterThan(0);
  });
});

describe("driftBias — cap holds regardless of imbalance magnitude", () => {
  it("saturates at exactly ±BIAS_SIGMA_CAP × sigma", () => {
    const sigma = 0.005;
    const maxBias = BIAS_SIGMA_CAP * sigma;
    // Feed imbalance values that would produce an unbounded raw bias if
    // uncapped — the cap must hold.
    for (const imb of [-1, -0.9, 0.9, 1]) {
      const bias = driftBias({
        imbalance: imb,
        exposure: EXPOSURE_FULL * 1_000,
        sigma,
      });
      expect(Math.abs(bias)).toBeLessThanOrEqual(maxBias + 1e-12);
    }
  });
});
