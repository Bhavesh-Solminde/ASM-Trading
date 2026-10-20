import { describe, expect, it } from "vitest";
import { fmtPrice } from "./format-price";

describe("fmtPrice", () => {
  it("groups thousands with commas at the symbol's precision", () => {
    expect(fmtPrice(94553.62, 2)).toBe("94,553.62");
    expect(fmtPrice(1234567.891, 2)).toBe("1,234,567.89");
    expect(fmtPrice(999.5, 2)).toBe("999.50");
  });

  it("uses Western grouping, not Indian (these are market prices)", () => {
    expect(fmtPrice(1234567, 0)).toBe("1,234,567");
  });

  it("leaves small prices alone", () => {
    expect(fmtPrice(0.12345, 5)).toBe("0.12345");
    expect(fmtPrice(1.1, 5)).toBe("1.10000");
  });

  it("keeps the sign", () => {
    expect(fmtPrice(-1234.5, 1)).toBe("-1,234.5");
  });

  it("has no decimal point at precision 0", () => {
    expect(fmtPrice(4200.4, 0)).toBe("4,200");
  });

  it("never throws on a non-finite or huge value", () => {
    expect(fmtPrice(Number.NaN, 2)).toBe("—");
    expect(fmtPrice(Number.POSITIVE_INFINITY, 2)).toBe("—");
    expect(() => fmtPrice(1e30, 2)).not.toThrow();
  });
});
