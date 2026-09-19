import { describe, expect, it } from "vitest";
import { formatMinor } from "./format-money";

describe("formatMinor", () => {
  it("formats minor units with the currency symbol and two decimals", () => {
    expect(formatMinor(1_000_000, "USD")).toBe("$10,000.00");
    expect(formatMinor(1_050, "USD")).toBe("$10.50");
    expect(formatMinor(0, "USD")).toBe("$0.00");
  });

  it("falls back to no symbol for an unknown currency", () => {
    expect(formatMinor(100, "XYZ")).toBe("1.00");
  });

  it("refuses a fractional minor amount rather than displaying a float", () => {
    expect(() => formatMinor(10.5, "USD")).toThrow(/integer/);
  });
});
