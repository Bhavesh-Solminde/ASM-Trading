import { describe, expect, it } from "vitest";
import {
  MAX_DEPOSIT_INR_MINOR,
  MAX_DEPOSIT_USDT_MINOR,
  MIN_DEPOSIT_INR_MINOR,
  MIN_DEPOSIT_USDT_MINOR,
} from "@asm/db";
import { INR_MAX, INR_MIN, USDT_MAX_USD, USDT_MIN_USD, methodAmountProblem, methodLimits, overallLimits } from "./limits";

describe("deposit limits mirror", () => {
  it("matches the bounds the server enforces", () => {
    expect(INR_MIN * 100).toBe(MIN_DEPOSIT_INR_MINOR);
    expect(INR_MAX * 100).toBe(MAX_DEPOSIT_INR_MINOR);
    expect(USDT_MIN_USD * 100).toBe(MIN_DEPOSIT_USDT_MINOR);
    expect(USDT_MAX_USD * 100).toBe(MAX_DEPOSIT_USDT_MINOR);
  });
});

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
