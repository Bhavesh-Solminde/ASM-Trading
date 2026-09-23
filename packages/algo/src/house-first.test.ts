import { describe, expect, it } from "vitest";
import type { Position } from "@asm/trading";
import { houseFirstWishes } from "./house-first";

/**
 * Table-driven coverage of the design in algorithm.md.
 *
 * The house-first algorithm is entirely deterministic given the input book:
 *   1. Whichever side has more real-money liability loses.
 *   2. Every rupee counts (no exposure floor, no whale cap).
 *   3. Bonus-portion stakes count at their real fraction (0 for pure bonus).
 *   4. Exact ties → deterministic pseudo-random tie break, seeded from
 *      (assetId, expirySec) so audits are re-playable.
 */

let seq = 0;
function p(overrides: Partial<Position> = {}): Position {
  return {
    tradeId: `t-${++seq}`,
    accountId: `a-${seq}`,
    assetId: "asset-1",
    direction: "UP",
    stake: 10_000,
    payoutPct: 87,
    entryPrice: 1.175,
    expirySec: 1_000_060,
    ...overrides,
  };
}

const SEED = "asset-1|1000060";

describe("houseFirstWishes — the algorithm.md test table", () => {
  it("5×₹500 UP vs 5×₹1000 DOWN → DOWN (bigger money) loses", () => {
    const positions: Position[] = [
      ...Array.from({ length: 5 }, () => p({ direction: "UP", stake: 50_000 })),
      ...Array.from({ length: 5 }, () => p({ direction: "DOWN", stake: 100_000 })),
    ];
    const out = houseFirstWishes(positions, SEED);
    expect(out.losingDirection).toBe("DOWN");
    expect(out.upLiability).toBeCloseTo(5 * 50_000 * 0.87, 6);
    expect(out.downLiability).toBeCloseTo(5 * 100_000 * 0.87, 6);
    // Every UP position wants a win, every DOWN wants a loss.
    for (const wish of out.wishes) {
      expect(wish.wantWin).toBe(wish.direction === "UP");
      expect(wish.urgency).toBeGreaterThan(1);
    }
    expect(out.tieBroken).toBe(false);
  });

  it("1×₹1 UP vs 1×₹2 DOWN → DOWN loses (every rupee counts)", () => {
    const positions: Position[] = [
      p({ direction: "UP", stake: 100 }), // ₹1
      p({ direction: "DOWN", stake: 200 }), // ₹2
    ];
    const out = houseFirstWishes(positions, SEED);
    expect(out.losingDirection).toBe("DOWN");
    // UP wish wants to win, DOWN wish wants to lose.
    expect(out.wishes[0]!.wantWin).toBe(true);
    expect(out.wishes[1]!.wantWin).toBe(false);
  });

  it("Exact tie → deterministic coin flip, same seed reproduces the outcome", () => {
    const positions: Position[] = [
      p({ direction: "UP", stake: 50_000 }),
      p({ direction: "DOWN", stake: 50_000 }),
    ];
    const first = houseFirstWishes(positions, SEED);
    expect(first.tieBroken).toBe(true);
    expect(first.upLiability).toBeCloseTo(first.downLiability, 9);
    // Same seed → same losingDirection.
    const second = houseFirstWishes(positions, SEED);
    expect(second.losingDirection).toBe(first.losingDirection);
    // Different seed can produce a different outcome (or the same by chance).
    const third = houseFirstWishes(positions, "different-seed-value");
    expect(third.tieBroken).toBe(true);
    // Not asserting difference — two randomly chosen seeds can collide on
    // the same bit. But we ARE asserting that the same seed is stable.
  });

  it("Single-sided book → all positions lose (house keeps everything)", () => {
    const positions: Position[] = Array.from({ length: 10 }, () =>
      p({ direction: "UP", stake: 50_000 }),
    );
    const out = houseFirstWishes(positions, SEED);
    // upLiability > 0, downLiability === 0 → UP has "more" → UP loses.
    expect(out.losingDirection).toBe("UP");
    for (const wish of out.wishes) {
      expect(wish.wantWin).toBe(false);
    }
  });

  it("Whale vs crowd → whale defines direction (no whale cap in house-first mode)", () => {
    // A single ₹1L UP bet + 100 × ₹100 DOWN. Whale liability = 10_00_000 × 0.87
    // = ₹87,000. Crowd liability = 100 × 10_000 × 0.87 = ₹87,000. Actually equal.
    // Push the whale to ₹1.1L so they're clearly bigger.
    const positions: Position[] = [
      p({ direction: "UP", stake: 11_000_000 }), // ₹1.1L
      ...Array.from({ length: 100 }, () => p({ direction: "DOWN", stake: 10_000 })),
    ];
    const out = houseFirstWishes(positions, SEED);
    expect(out.upLiability).toBeGreaterThan(out.downLiability);
    expect(out.losingDirection).toBe("UP");
    // The whale loses.
    expect(out.wishes[0]!.wantWin).toBe(false);
  });
});

describe("houseFirstWishes — bonus-fraction accounting (Q3 in algorithm.md)", () => {
  it("pure-bonus stakes contribute 0 liability", () => {
    // stakeFromBonus === stake → realFraction = 0 → liability = 0.
    // The mock cast is deliberate — the shared Position type doesn't expose
    // stakeFromBonus, but the house-first module reads it defensively.
    const bonusOnly = {
      ...p({ direction: "UP", stake: 100_000 }),
      stakeFromBonus: 100_000,
    } as unknown as Position;
    const bonusOnly2 = {
      ...p({ direction: "UP", stake: 100_000 }),
      stakeFromBonus: 100_000,
    } as unknown as Position;
    const realDown = p({ direction: "DOWN", stake: 100 });
    const out = houseFirstWishes([bonusOnly, bonusOnly2, realDown], SEED);
    // UP has 2 × 0 = 0 real liability. DOWN has 100 × 0.87 = 87. DOWN wins the
    // bigger side by any tiny amount.
    expect(out.upLiability).toBe(0);
    expect(out.downLiability).toBeCloseTo(87, 6);
    expect(out.losingDirection).toBe("DOWN");
    // The bonus-only UPs are on the winning side and their wishes reflect it.
    expect(out.wishes[0]!.wantWin).toBe(true);
    expect(out.wishes[1]!.wantWin).toBe(true);
  });

  it("50%-bonus stake contributes half the liability of a full-real stake", () => {
    const halfBonus = {
      ...p({ direction: "UP", stake: 100_000 }),
      stakeFromBonus: 50_000,
    } as unknown as Position;
    const fullReal = p({ direction: "DOWN", stake: 100_000 });
    const out = houseFirstWishes([halfBonus, fullReal], SEED);
    // halfBonus: 100k × 0.87 × (50k/100k) = 43_500
    // fullReal:  100k × 0.87            = 87_000
    expect(out.upLiability).toBeCloseTo(43_500, 6);
    expect(out.downLiability).toBeCloseTo(87_000, 6);
    expect(out.losingDirection).toBe("DOWN");
  });
});

describe("houseFirstWishes — edge cases", () => {
  it("empty book → no wishes, no direction", () => {
    const out = houseFirstWishes([], SEED);
    expect(out.wishes).toHaveLength(0);
    expect(out.losingDirection).toBeNull();
    expect(out.upLiability).toBe(0);
    expect(out.downLiability).toBe(0);
  });

  it("wishes preserve input order and per-position stake/payoutPct", () => {
    const positions: Position[] = [
      p({ direction: "UP", stake: 25_000, payoutPct: 80 }),
      p({ direction: "DOWN", stake: 40_000, payoutPct: 90 }),
      p({ direction: "UP", stake: 25_000, payoutPct: 80 }),
    ];
    const out = houseFirstWishes(positions, SEED);
    expect(out.wishes).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(out.wishes[i]!.direction).toBe(positions[i]!.direction);
      expect(out.wishes[i]!.stake).toBe(positions[i]!.stake);
      expect(out.wishes[i]!.payoutPct).toBe(positions[i]!.payoutPct);
    }
  });

  it("different payoutPct across positions is factored into liability", () => {
    // Same stake, different payoutPct → the one with the higher payoutPct
    // exposes the house to more money on a win.
    const positions: Position[] = [
      p({ direction: "UP", stake: 100_000, payoutPct: 100 }),
      p({ direction: "DOWN", stake: 100_000, payoutPct: 87 }),
    ];
    const out = houseFirstWishes(positions, SEED);
    expect(out.upLiability).toBe(100_000);
    expect(out.downLiability).toBe(87_000);
    expect(out.losingDirection).toBe("UP");
  });
});
