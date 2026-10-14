import { describe, expect, it } from "vitest";
import { DEFAULT_EXPIRY_SEC, resolveExpiry, stakeAmountOpts, stakeDisplay, validateStake } from "./stake-input";

describe("validateStake", () => {
  it("rejects an empty stake", () => {
    expect(validateStake("", "INR", 1_000_00)).toEqual({ ok: false, reason: "empty" });
    expect(validateStake("   ", "INR", 1_000_00)).toEqual({ ok: false, reason: "empty" });
    expect(validateStake("0", "INR", 1_000_00)).toEqual({ ok: false, reason: "empty" });
    expect(validateStake(".", "USD", 1_000_00)).toEqual({ ok: false, reason: "empty" });
  });
  it("enforces the ₹100 minimum on INR accounts", () => {
    expect(validateStake("99", "INR", 1_000_00)).toEqual({ ok: false, reason: "min" });
    expect(validateStake("100", "INR", 1_000_00)).toEqual({ ok: true, minor: 10_000 });
  });
  it("enforces the $1 minimum on USD accounts", () => {
    expect(validateStake("0.5", "USD", 10_000)).toEqual({ ok: false, reason: "min" });
    expect(validateStake("1", "USD", 10_000)).toEqual({ ok: true, minor: 100 });
    expect(validateStake("12.34", "USD", 10_000)).toEqual({ ok: true, minor: 1234 });
  });
  it("refuses a stake above the available balance, allows exactly the balance", () => {
    expect(validateStake("500", "INR", 10_000)).toEqual({ ok: false, reason: "balance" });
    expect(validateStake("100", "INR", 10_000)).toEqual({ ok: true, minor: 10_000 });
  });
  it("reports the minimum before the balance when both fail", () => {
    expect(validateStake("50", "INR", 100)).toEqual({ ok: false, reason: "min" });
  });
  it("refuses a stake the server contract would reject (over the maximum)", () => {
    expect(validateStake("1000001", "INR", Number.MAX_SAFE_INTEGER)).toEqual({ ok: false, reason: "max" });
    expect(validateStake("1000000", "INR", Number.MAX_SAFE_INTEGER)).toEqual({ ok: true, minor: 100_000_000 });
  });
  it("treats a non-finite balance as zero", () => {
    expect(validateStake("100", "INR", Number.NaN)).toEqual({ ok: false, reason: "balance" });
  });
});

describe("stakeAmountOpts", () => {
  it("allows decimals only on non-INR accounts", () => {
    expect(stakeAmountOpts("INR").decimals).toBe(false);
    expect(stakeAmountOpts("USD").decimals).toBe(true);
  });
  it("caps the whole part at the contract's maximum digits", () => {
    expect(stakeAmountOpts("INR").maxInt).toBe(7);
  });
});

describe("stakeDisplay", () => {
  it("groups digits and keeps a trailing point or decimals", () => {
    expect(stakeDisplay("")).toBe("0");
    expect(stakeDisplay("1250")).toBe("1,250");
    expect(stakeDisplay("12.")).toBe("12.");
    expect(stakeDisplay("12.5")).toBe("12.5");
  });
});

describe("resolveExpiry", () => {
  it("keeps an offered duration", () => {
    expect(resolveExpiry(30)).toBe(30);
    expect(resolveExpiry(14_400)).toBe(14_400);
  });
  it("falls back to the default for a saved value the server no longer offers", () => {
    expect(resolveExpiry(45)).toBe(DEFAULT_EXPIRY_SEC);
    expect(resolveExpiry(0)).toBe(DEFAULT_EXPIRY_SEC);
  });
});
