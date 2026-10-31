import { describe, expect, it } from "vitest";
import { DEPOSIT_QUICK_INR, INR_MAX, INR_MIN, methodAmountProblem, methodLimits, overallLimits } from "./deposit-limits";

describe("per-method limits", () => {
  it("converts the USDT bounds to rupees at ₹110 = $1", () => {
    expect(methodLimits("USDT")).toEqual({ min: 1_100, max: 1_100_000 });
  });
  it("explains why a method can't take an amount", () => {
    expect(methodAmountProblem("UPI", 499)).toBe("Minimum ₹500");
    expect(methodAmountProblem("USDT", 1_099)).toBe("Minimum ₹1,100 ($10)");
    expect(methodAmountProblem("UPI", 1_000)).toBeNull();
    expect(methodAmountProblem("USDT", 1_100_001)).toBe("Maximum ₹1,100,000 ($10,000)");
  });
  it("takes the loosest bounds across the offered methods", () => {
    expect(overallLimits(["UPI", "USDT"]).min).toBe(500);
    expect(overallLimits(["USDT"]).min).toBe(1_100);
    expect(overallLimits([])).toEqual({ min: 500, max: 1_000_000 });
  });
});

describe("DEPOSIT_QUICK_INR", () => {
  it("is the four quick amounts, all within the rupee limits", () => {
    expect([...DEPOSIT_QUICK_INR]).toEqual([500, 1000, 2000, 5000]);
    for (const v of DEPOSIT_QUICK_INR) {
      expect(v).toBeGreaterThanOrEqual(INR_MIN);
      expect(v).toBeLessThanOrEqual(INR_MAX);
    }
  });
});
