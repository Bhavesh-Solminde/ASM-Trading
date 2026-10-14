import { describe, expect, it } from "vitest";
import { INR_MAX, INR_MIN, USDT_MAX_USD, USDT_MIN_USD, methodAmountProblem, methodLimits, overallLimits } from "./deposit-limits";

describe("per-method limits", () => {
  it("converts the USDT bounds to rupees at ₹100 = $1", () => {
    expect(methodLimits("USDT")).toEqual({ min: 1_000, max: 1_000_000 });
  });
  it("explains why a method can't take an amount", () => {
    expect(methodAmountProblem("UPI", 499)).toBe("Minimum ₹500");
    expect(methodAmountProblem("USDT", 500)).toBe("Minimum ₹1,000 ($10)");
    expect(methodAmountProblem("UPI", 1_000)).toBeNull();
    expect(methodAmountProblem("USDT", 1_000_001)).toBe("Maximum ₹1,000,000 ($10,000)");
  });
  it("takes the loosest bounds across the offered methods", () => {
    expect(overallLimits(["UPI", "USDT"]).min).toBe(500);
    expect(overallLimits(["USDT"]).min).toBe(1_000);
    expect(overallLimits([])).toEqual({ min: 500, max: 1_000_000 });
  });
});
