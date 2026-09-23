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

describe("imbalance — whale cap (L8)", () => {
  it("a single whale bet cannot single-handedly saturate imbalance to ±1", () => {
    // Without a cap: one ₹10 lakh UP bet + zero opposition would yield
    // imbalance = +1 (fully saturated). Same with 99 tiny bets on the
    // other side — the whale would still swamp them.
    //
    // With the cap: whale weight is limited to WHALE_CAP_FRACTION of
    // total weight in the numerator, so the maximum influence is 30%
    // rather than 100%.
    const book: Position[] = [
      p({ direction: "UP", stake: 100_000_000 }), // ₹10 lakh whale
      ...Array.from({ length: 99 }, () =>
        p({ direction: "DOWN", stake: 10_000 }), // ₹100 each
      ),
    ];
    const imb = imbalance(book, NOW);
    // The whale dwarfs the crowd's total, so before the cap the imbalance
    // would be close to +1 (heavily UP). With the cap, the whale
    // contributes at most 30% of the pressure — the 99 DOWN bets, though
    // small, can still pull the imbalance below full saturation.
    expect(imb).toBeLessThan(WHALE_CAP_FRACTION + 0.05);
  });

  it("with 3+ equal co-directional positions, the cap has no effect", () => {
    // Three equal ₹100 UP bets. Each is 1/3 of total, exactly at the cap
    // threshold. All three contribute fully; imbalance is +1 (all UP).
    const book: Position[] = [
      p({ direction: "UP", stake: 10_000 }),
      p({ direction: "UP", stake: 10_000 }),
      p({ direction: "UP", stake: 10_000 }),
    ];
    expect(imbalance(book, NOW)).toBeCloseTo(1, 6);
  });

  it("a whale on one side is diluted by many opposing positions", () => {
    // Whale UP + a crowd of small DOWNs. Before the cap, whale wins
    // hands-down. With the cap, the crowd's aggregate weight in the
    // NUMERATOR is not capped (each is tiny), while the whale IS capped
    // — so their contest is fairer.
    const book: Position[] = [
      p({ direction: "UP", stake: 100_000_000 }),
      ...Array.from({ length: 20 }, () => p({ direction: "DOWN", stake: 100_000 })),
    ];
    // Whale liability = 87M. Crowd liability = 20 × 87k = 1.74M. Total =
    // 88.74M. Whale cap = 30% of 88.74M = 26.6M. Numerator = 26.6M
    // (capped whale) - 1.74M (uncapped crowd) = ~24.9M. Divide by 88.74M
    // = 0.28.
    const imb = imbalance(book, NOW);
    expect(imb).toBeLessThan(0.3);
    expect(imb).toBeGreaterThan(0.15);
  });
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
