import { describe, expect, it } from "vitest";
import { normalizedMinorToRaw, RAW_PER_MINOR, rawToNormalizedMinor } from "./usdt-money";

describe("rawToNormalizedMinor", () => {
  it("converts an exact multiple of 10_000 to USDT-cents", () => {
    expect(rawToNormalizedMinor(1_001_837_420_000n)).toBe(100_183_742);
    expect(rawToNormalizedMinor(10_000n)).toBe(1);
    expect(rawToNormalizedMinor(1_000_000n)).toBe(100);
  });

  it("returns null for a raw amount with genuine sub-cent on-chain precision — never rounds or truncates", () => {
    expect(rawToNormalizedMinor(1_000_001n)).toBeNull();
    expect(rawToNormalizedMinor(9_999n)).toBeNull();
  });

  it("returns null for zero or negative amounts", () => {
    expect(rawToNormalizedMinor(0n)).toBeNull();
    expect(rawToNormalizedMinor(-10_000n)).toBeNull();
  });

  it("returns null rather than overflowing for an amount beyond the safe integer range", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * RAW_PER_MINOR + RAW_PER_MINOR;
    expect(rawToNormalizedMinor(huge)).toBeNull();
  });
});

describe("normalizedMinorToRaw", () => {
  it("is the exact inverse of rawToNormalizedMinor for representable amounts", () => {
    expect(normalizedMinorToRaw(100)).toBe(1_000_000n);
    expect(normalizedMinorToRaw(1)).toBe(10_000n);
    const minor = rawToNormalizedMinor(1_001_837_420_000n);
    expect(normalizedMinorToRaw(minor!)).toBe(1_001_837_420_000n);
  });

  it("rejects a non-positive-integer input", () => {
    expect(() => normalizedMinorToRaw(0)).toThrow(/positive integer/);
    expect(() => normalizedMinorToRaw(-5)).toThrow(/positive integer/);
    expect(() => normalizedMinorToRaw(1.5)).toThrow(/positive integer/);
  });
});
