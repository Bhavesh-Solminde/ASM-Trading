import { describe, expect, it } from "vitest";
import { normalizedMinorToRaw, rawPerMinor, rawToNormalizedMinor } from "./usdt-money";

describe("rawPerMinor", () => {
  it("is 10^(decimals-2)", () => {
    expect(rawPerMinor(2)).toBe(1n);
    expect(rawPerMinor(6)).toBe(10_000n);
    expect(rawPerMinor(18)).toBe(10_000_000_000_000_000n);
  });

  it("throws for decimals < 2 or a non-integer", () => {
    expect(() => rawPerMinor(1)).toThrow(/>= 2/);
    expect(() => rawPerMinor(0)).toThrow(/>= 2/);
    expect(() => rawPerMinor(-6)).toThrow(/>= 2/);
    expect(() => rawPerMinor(6.5)).toThrow(/>= 2/);
    expect(() => rawPerMinor(Number.NaN)).toThrow(/>= 2/);
  });
});

describe("rawToNormalizedMinor (6 decimals — TRON USDT)", () => {
  it("converts an exact multiple of 10_000 to USDT-cents", () => {
    expect(rawToNormalizedMinor(1_001_837_420_000n, 6)).toBe(100_183_742);
    expect(rawToNormalizedMinor(10_000n, 6)).toBe(1);
    expect(rawToNormalizedMinor(1_000_000n, 6)).toBe(100);
  });

  it("returns null for a raw amount with genuine sub-cent on-chain precision — never rounds or truncates", () => {
    expect(rawToNormalizedMinor(1_000_001n, 6)).toBeNull();
    expect(rawToNormalizedMinor(9_999n, 6)).toBeNull();
  });

  it("returns null for zero or negative amounts", () => {
    expect(rawToNormalizedMinor(0n, 6)).toBeNull();
    expect(rawToNormalizedMinor(-10_000n, 6)).toBeNull();
  });

  it("returns null rather than overflowing for an amount beyond the safe integer range", () => {
    const per = rawPerMinor(6);
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * per + per;
    expect(rawToNormalizedMinor(huge, 6)).toBeNull();
  });
});

describe("rawToNormalizedMinor (18 decimals — BSC USDT)", () => {
  it("converts an exact multiple of 10^16 to USDT-cents", () => {
    expect(rawToNormalizedMinor(25_260_000_000_000_000_000n, 18)).toBe(2526);
    expect(rawToNormalizedMinor(10_000_000_000_000_000n, 18)).toBe(1);
    // 1,000,000 USDT — far above int8 in raw form.
    expect(rawToNormalizedMinor(1_000_000n * 10n ** 18n, 18)).toBe(100_000_000);
  });

  it("returns null for a sub-cent 18dp amount — never rounds or truncates", () => {
    expect(rawToNormalizedMinor(25_260_000_000_000_000_001n, 18)).toBeNull();
    expect(rawToNormalizedMinor(9_999_999_999_999_999n, 18)).toBeNull(); // just under 1 cent
    expect(rawToNormalizedMinor(1n, 18)).toBeNull();
  });

  it("returns null for zero or negative amounts", () => {
    expect(rawToNormalizedMinor(0n, 18)).toBeNull();
    expect(rawToNormalizedMinor(-(10n ** 16n), 18)).toBeNull();
  });

  it("returns null rather than overflowing beyond the safe integer range", () => {
    const per = rawPerMinor(18);
    expect(rawToNormalizedMinor(BigInt(Number.MAX_SAFE_INTEGER) * per + per, 18)).toBeNull();
  });

  it("throws for decimals < 2", () => {
    expect(() => rawToNormalizedMinor(100n, 1)).toThrow(/>= 2/);
  });
});

describe("normalizedMinorToRaw", () => {
  it("is the exact inverse of rawToNormalizedMinor for representable amounts (6dp)", () => {
    expect(normalizedMinorToRaw(100, 6)).toBe(1_000_000n);
    expect(normalizedMinorToRaw(1, 6)).toBe(10_000n);
    const minor = rawToNormalizedMinor(1_001_837_420_000n, 6);
    expect(normalizedMinorToRaw(minor!, 6)).toBe(1_001_837_420_000n);
  });

  it("is the exact inverse of rawToNormalizedMinor for representable amounts (18dp)", () => {
    expect(normalizedMinorToRaw(2526, 18)).toBe(25_260_000_000_000_000_000n);
    const raw = 1_000_000n * 10n ** 18n;
    expect(normalizedMinorToRaw(rawToNormalizedMinor(raw, 18)!, 18)).toBe(raw);
  });

  it("rejects a non-positive-integer input", () => {
    expect(() => normalizedMinorToRaw(0, 6)).toThrow(/positive integer/);
    expect(() => normalizedMinorToRaw(-5, 6)).toThrow(/positive integer/);
    expect(() => normalizedMinorToRaw(1.5, 18)).toThrow(/positive integer/);
  });

  it("throws for decimals < 2", () => {
    expect(() => normalizedMinorToRaw(100, 1)).toThrow(/>= 2/);
  });
});
