import { describe, expect, it } from "vitest";
import { BONUS_TIERS as SERVER_TIERS } from "@asm/db";
import { BONUS_TIERS, bonusPercentForDeposit, ordinal } from "./bonus";

describe("bonus tiers mirror", () => {
  it("matches the tiers the server grants", () => {
    expect([...BONUS_TIERS]).toEqual([...SERVER_TIERS]);
  });

  it("gives 0% after the last tier", () => {
    expect(bonusPercentForDeposit(BONUS_TIERS.length + 1)).toBe(0);
  });

  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
  });
});
