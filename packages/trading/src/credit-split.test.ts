import { describe, expect, it } from "vitest";
import { splitSettlementCredit } from "./credit-split";

describe("splitSettlementCredit", () => {
  it("returns everything to real when the stake was all real money", () => {
    expect(splitSettlementCredit(20_000, 10_000, 0)).toEqual({ toReal: 20_000, toBonus: 0 });
  });

  it("returns everything to bonus when the stake was all bonus money", () => {
    expect(splitSettlementCredit(20_000, 10_000, 10_000)).toEqual({ toReal: 0, toBonus: 20_000 });
  });

  it("splits in the stake's proportion", () => {
    // 60% of the stake came from bonus, so 60% of the credit returns there.
    expect(splitSettlementCredit(20_000, 10_000, 6_000)).toEqual({ toReal: 8_000, toBonus: 12_000 });
  });

  it("refunds a mixed stake back to exactly where it came from", () => {
    expect(splitSettlementCredit(10_000, 10_000, 3_500)).toEqual({ toReal: 6_500, toBonus: 3_500 });
  });

  it("always sums to the credit, whatever the rounding", () => {
    for (const [credit, stake, bonus] of [
      [557, 333, 111],
      [1, 3, 1],
      [19_999, 7, 5],
      [0, 10, 4],
    ] as const) {
      const { toReal, toBonus } = splitSettlementCredit(credit, stake, bonus);
      expect(toReal + toBonus).toBe(credit);
      expect(Number.isInteger(toBonus)).toBe(true);
    }
  });

  it("rejects a bonus share larger than the stake", () => {
    expect(() => splitSettlementCredit(100, 10, 11)).toThrow(/stakeFromBonus/);
  });

  it("rounds the remainder to bonus (the sticky side) — anti-drain guard", () => {
    // stakeFromBonus=30, stake=100, credit=187 (WON at payout 87%).
    // Proportional bonus share is 56.1. Old behaviour floored to 56, letting
    // 0.1 (rounded to 1 minor unit) migrate to real over the settlement. The
    // fixed behaviour rounds up on bonus, keeping the leftover on the sticky
    // side.
    expect(splitSettlementCredit(187, 100, 30)).toEqual({ toReal: 130, toBonus: 57 });
  });

  it("never migrates a minor unit into bonus for a pure-real trade", () => {
    // stakeFromBonus = 0 short-circuits, so no rounding artefact ever grants
    // the user free bonus balance from a real-money trade.
    expect(splitSettlementCredit(1, 3, 0)).toEqual({ toReal: 1, toBonus: 0 });
    expect(splitSettlementCredit(9_999, 10_000, 0)).toEqual({ toReal: 9_999, toBonus: 0 });
  });

  it("returns zero on both sides for a lost trade", () => {
    expect(splitSettlementCredit(0, 10_000, 6_000)).toEqual({ toReal: 0, toBonus: 0 });
  });

  it("cumulative bonus balance never drops across many mixed settlements", () => {
    // Simulate 10_000 settlements of a fixed mixed stake. Under the old
    // floor-toBonus rule, bonus principal leaked into real one minor unit at
    // a time. Under the fixed rule (ceil bonus), bonus never goes below its
    // proportional share of the total credit stream.
    const stake = 100;
    const stakeFromBonus = 30;
    const payoutCredit = 187; // stake + 87% payout
    let bonusTotal = 0;
    let realTotal = 0;
    for (let i = 0; i < 10_000; i++) {
      const { toReal, toBonus } = splitSettlementCredit(payoutCredit, stake, stakeFromBonus);
      bonusTotal += toBonus;
      realTotal += toReal;
    }
    // Proportional target: bonus should have >= 30% of total credit.
    const total = bonusTotal + realTotal;
    expect(bonusTotal / total).toBeGreaterThanOrEqual(0.3);
  });
});
