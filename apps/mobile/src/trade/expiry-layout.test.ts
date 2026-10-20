import { describe, expect, it } from "vitest";
import { EXPIRY_CHIP_GAP, expiryChipWidth } from "./expiry-layout";

describe("expiryChipWidth", () => {
  it("fits four chips and three gaps exactly into the sheet content", () => {
    for (const screen of [320, 360, 412]) {
      const content = screen - 40;
      expect(4 * expiryChipWidth(screen) + 3 * EXPIRY_CHIP_GAP).toBeLessThanOrEqual(content);
    }
  });

  it("does not overflow at 320dp, where 23% chips wrapped to three columns", () => {
    expect(expiryChipWidth(320)).toBe(Math.floor((280 - 24) / 4));
  });

  it("never returns less than a 44pt target", () => {
    expect(expiryChipWidth(200)).toBeGreaterThanOrEqual(44);
  });
});
