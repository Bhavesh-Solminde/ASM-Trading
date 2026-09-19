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
});
