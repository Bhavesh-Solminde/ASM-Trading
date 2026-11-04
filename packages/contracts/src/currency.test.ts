import { describe, expect, it } from "vitest";
import { USD_INR_RATE, convertMinorBetween } from "./currency";
import { withdrawalLimitsMinor } from "./withdrawal";

describe("platform FX rate", () => {
  it("is ₹110 = $1 (owner decision 2026-10-31)", () => {
    expect(USD_INR_RATE).toBe(110);
  });

  it("converts INR paise to USD cents and back, rounding half up (Math.round)", () => {
    expect(convertMinorBetween(11_000, "INR", "USD")).toBe(100); // ₹110 -> $1
    expect(convertMinorBetween(100, "USD", "INR")).toBe(11_000);
    expect(convertMinorBetween(55, "INR", "USD")).toBe(1); // 0.5 rounds up
    expect(convertMinorBetween(54, "INR", "USD")).toBe(0);
    expect(convertMinorBetween(-55, "INR", "USD") + 0).toBe(0); // Math.round(-0.5) is -0
    expect(convertMinorBetween(-165, "INR", "USD")).toBe(-1); // -1.5 -> -1
    expect(convertMinorBetween(1234, "INR", "INR")).toBe(1234);
    expect(convertMinorBetween(1234, "INR", "GBP")).toBe(1234); // unknown pair: untouched
  });

  it("round-trips exactly for amounts that are whole dollars", () => {
    for (const cents of [100, 12_345, 4_545_400]) {
      expect(convertMinorBetween(convertMinorBetween(cents, "USD", "INR"), "INR", "USD")).toBe(cents);
    }
  });
});

describe("withdrawal limits follow the shared rate", () => {
  it("keeps ₹700 – ₹50,000 as the source and derives the USD limits from it", () => {
    expect(withdrawalLimitsMinor("INR")).toEqual({ min: 70_000, max: 5_000_000 });
    expect(withdrawalLimitsMinor("USD")).toEqual({
      min: convertMinorBetween(70_000, "INR", "USD"),
      max: convertMinorBetween(5_000_000, "INR", "USD"),
    });
    expect(withdrawalLimitsMinor("USD")).toEqual({ min: 636, max: 45_455 }); // $6.36 – $454.55
  });
});
