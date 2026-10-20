import { describe, expect, it } from "vitest";
import { COMPACT_WIDTH, fitFigureSize, isCompactWidth } from "./header-fit";

describe("isCompactWidth", () => {
  it("treats 320dp and 360dp phones as compact, 411dp as regular", () => {
    expect(isCompactWidth(320)).toBe(true);
    expect(isCompactWidth(COMPACT_WIDTH - 1)).toBe(true);
    expect(isCompactWidth(COMPACT_WIDTH)).toBe(false);
    expect(isCompactWidth(411)).toBe(false);
  });
});

describe("fitFigureSize", () => {
  const base = { text: "₹9,99,900.00", base: 16, min: 10, fontScale: 1 };

  it("keeps the base size when the figure fits", () => {
    expect(fitFigureSize({ ...base, available: 200 })).toBe(16);
  });

  it("shrinks until the whole figure fits the room it has", () => {
    const size = fitFigureSize({ ...base, available: 100 });
    expect(size).toBeLessThan(16);
    expect(size).toBeGreaterThanOrEqual(10);
    // The estimate must say it fits: 12 characters at the fitted size.
    expect(size * 0.64 * 12).toBeLessThanOrEqual(100);
  });

  it("allows for a larger system font scale", () => {
    const normal = fitFigureSize({ ...base, available: 110 });
    const big = fitFigureSize({ ...base, available: 110, fontScale: 1.3 });
    expect(big).toBeLessThan(normal);
  });

  it("never drops below the minimum, and uses the base before the width is known", () => {
    expect(fitFigureSize({ ...base, available: 20 })).toBe(10);
    expect(fitFigureSize({ ...base, available: 0 })).toBe(16);
    expect(fitFigureSize({ ...base, available: null })).toBe(16);
  });

  it("returns whole or half points only", () => {
    const size = fitFigureSize({ ...base, available: 97 });
    expect(size * 2).toBe(Math.round(size * 2));
  });
});
