import { describe, expect, it } from "vitest";
import { BEAST_OPACITY, BUTTON_H, bearFrame, bullFrame } from "./beast-frame";

describe("beast-frame constants", () => {
  it("matches the canvas: 62pt buttons, art at full opacity", () => {
    expect(BUTTON_H).toBe(62);
    expect(BEAST_OPACITY).toBe(1);
  });
});

describe("bullFrame", () => {
  it("sits where the owner put it on the 176pt canvas button", () => {
    const f = bullFrame(176);
    expect(f.x).toBeCloseTo(105, 1);
    expect(f.y).toBe(-3);
    expect(f.h).toBe(88);
    expect(f.w).toBeCloseTo(65.2, 1);
  });
  it.each([161, 176, 206])("keeps a 5.8pt gap to the right edge at %ipt wide, so the head is never cropped", (w) => {
    const f = bullFrame(w);
    expect(f.x + f.w).toBeCloseTo(w - 5.8);
  });
});

describe("bearFrame", () => {
  it("is the cover-cropped 59pt wide image hanging 1pt past the right edge", () => {
    const f = bearFrame(176);
    expect(f.w).toBe(59);
    expect(f.h).toBeCloseTo(79.18, 1);
    expect(f.y).toBeCloseTo(-9.19, 1);
    expect(f.x).toBeCloseTo(176 - 58);
  });
  it.each([161, 176, 206])("ends 1pt past the right edge at %ipt wide", (w) => {
    const f = bearFrame(w);
    expect(f.x + f.w).toBeCloseTo(w + 1);
  });
});
