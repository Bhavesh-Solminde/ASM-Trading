import { describe, expect, it } from "vitest";
import { applyKey, groupAmount, sanitizeAmount } from "./amount-input";

const whole = { decimals: false };
const money = { decimals: true };

describe("sanitizeAmount", () => {
  it("strips non-digits and leading zeros", () => {
    expect(sanitizeAmount("₹0,0120", whole)).toBe("120");
  });
  it("drops the decimal point when decimals are off", () => {
    expect(sanitizeAmount("12.5", whole)).toBe("125");
  });
  it("keeps one point and two decimals", () => {
    expect(sanitizeAmount("1.2.345", money)).toBe("1.23");
    expect(sanitizeAmount(".5", money)).toBe("0.5");
  });
  it("caps the whole part", () => {
    expect(sanitizeAmount("1234567890123", whole)).toHaveLength(9);
  });
});

describe("applyKey", () => {
  it("appends digits and deletes", () => {
    let v = "";
    for (const k of ["1", "0", "0", "0"]) v = applyKey(v, k, whole);
    expect(v).toBe("1000");
    expect(applyKey(v, "back", whole)).toBe("100");
    expect(applyKey("", "back", whole)).toBe("");
  });
  it("ignores a leading zero press and a point on whole amounts", () => {
    expect(applyKey("", "0", whole)).toBe("0");
    expect(applyKey("0", "5", whole)).toBe("5");
    expect(applyKey("5", ".", whole)).toBe("5");
  });
  it("handles a decimal point once", () => {
    expect(applyKey("", ".", money)).toBe("0.");
    expect(applyKey("7", ".", money)).toBe("7.");
    expect(applyKey("7.5", ".", money)).toBe("7.5");
    expect(applyKey("7.55", "9", money)).toBe("7.55");
  });
});

describe("groupAmount", () => {
  it("groups with commas", () => {
    expect(groupAmount("")).toBe("0");
    expect(groupAmount("1000000")).toBe("1,000,000");
    expect(groupAmount("1234.5")).toBe("1,234.5");
  });
});
