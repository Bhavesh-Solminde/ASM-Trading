import { describe, expect, it } from "vitest";
import { fontPath, readFont } from "./ttf-reader";

describe("ttf-reader", () => {
  it("reads units per em and advances from a bundled font", () => {
    const martian = readFont(fontPath("martian-mono", "MartianMono_600SemiBold"));
    expect(martian.unitsPerEm).toBe(1000);
    expect(martian.advanceEm("0")).toBeCloseTo(0.7, 5);
    const anek = readFont(fontPath("anek-latin", "AnekLatin_600SemiBold"));
    expect(anek.unitsPerEm).toBe(2000);
    expect(anek.advanceEm("₹")).toBeCloseTo(1033 / 2000, 5);
    expect(martian.advanceEm("₹")).toBeNull();
  });
});
