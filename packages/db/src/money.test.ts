import { describe, expect, it } from "vitest";
import { formatMoney, toMajor, toMinor } from "./money.js";

describe("money", () => {
  it("converts major units to integer minor units", () => {
    expect(toMinor(100)).toBe(10000);
    expect(toMinor(10.5)).toBe(1050);
    expect(toMinor(0.01)).toBe(1);
  });

  it("rounds half away from zero rather than using float truncation", () => {
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(10.145)).toBe(1015);
  });

  it("converts minor units back to major", () => {
    expect(toMajor(10000)).toBe(100);
    expect(toMajor(1050)).toBe(10.5);
  });

  it("rejects non-integer minor units", () => {
    expect(() => toMajor(10.5)).toThrow(/integer/);
  });

  it("formats with two decimals and a currency symbol", () => {
    expect(formatMoney(1000646, "USD")).toBe("$10,006.46");
    expect(formatMoney(1076400, "INR")).toBe("₹10,764.00");
  });
});
