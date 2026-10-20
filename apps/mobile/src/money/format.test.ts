import { describe, expect, it } from "vitest";
import { groupIndian, groupTyped, money } from "./format";

describe("groupIndian", () => {
  it("groups the last three digits, then pairs", () => {
    expect(groupIndian("0")).toBe("0");
    expect(groupIndian("999")).toBe("999");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("99999")).toBe("99,999");
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupIndian("999600")).toBe("9,99,600");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
  });
});

describe("money", () => {
  it("formats INR in Indian grouping with paise", () => {
    expect(money(99960000, "INR")).toBe("₹9,99,600.00");
    expect(money(18600, "INR")).toBe("₹186.00");
    expect(money(5, "INR")).toBe("₹0.05");
  });
  it("trims .00 on whole amounts only when asked", () => {
    expect(money(193000, "INR", { trim: true })).toBe("₹1,930");
    expect(money(193050, "INR", { trim: true })).toBe("₹1,930.50");
    expect(money(1000, "USD", { trim: true })).toBe("$10");
  });
  it("keeps Western grouping for other currencies", () => {
    expect(money(123456789, "USD")).toBe("$1,234,567.89");
  });
  it("leads a negative amount with a minus sign", () => {
    expect(money(-1400, "INR")).toBe("−₹14.00");
    expect(money(-100, "USD")).toBe("−$1.00");
  });
  it("never throws on a figure from an unvalidated source: a fractional minor unit rounds, a non-number is a dash", () => {
    expect(money(150.4, "INR")).toBe("₹1.50");
    expect(money(-150.6, "INR")).toBe("−₹1.51");
    expect(money(Number.NaN, "INR")).toBe("—");
    expect(money(Number.POSITIVE_INFINITY, "USD")).toBe("—");
    expect(money(1e300, "INR")).toBe("—");
  });
});

describe("groupTyped", () => {
  it("groups typed whole rupees the Indian way", () => {
    expect(groupTyped("", "INR")).toBe("0");
    expect(groupTyped("2500", "INR")).toBe("2,500");
    expect(groupTyped("125000", "INR")).toBe("1,25,000");
  });
  it("keeps the client-core behaviour elsewhere (trailing point kept while typing)", () => {
    expect(groupTyped("1250", "USD")).toBe("1,250");
    expect(groupTyped("12.", "USD")).toBe("12.");
    expect(groupTyped("12.5", "USD")).toBe("12.5");
  });
});
