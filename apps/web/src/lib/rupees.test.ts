import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "./rupees";

describe("rupeesToPaise", () => {
  it("parses rupees to exact paise", () => {
    expect(rupeesToPaise("1999")).toBe(199_900);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1_999);
    expect(rupeesToPaise("0.29")).toBe(29); // 0.29 * 100 is 28.999… in floats
  });
  it("ignores ₹, commas and spaces the way people type amounts", () => {
    expect(rupeesToPaise("₹1,23,456.78")).toBe(12_345_678);
    expect(rupeesToPaise("2,000")).toBe(200_000);
    expect(rupeesToPaise(" ₹ 1999 ")).toBe(199_900);
  });
  it("accepts a sign only when asked", () => {
    expect(rupeesToPaise("-50")).toBeNull();
    expect(rupeesToPaise("-99.50", { signed: true })).toBe(-9_950);
    expect(rupeesToPaise("+5", { signed: true })).toBe(500);
  });
  it("rejects junk and over-precision", () => {
    for (const bad of ["", "abc", "1.234", "1e3", "1.", "--1"]) expect(rupeesToPaise(bad, { signed: true })).toBeNull();
  });
});
