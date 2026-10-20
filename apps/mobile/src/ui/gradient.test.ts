import { describe, expect, it } from "vitest";
import { cssGradientPoints } from "./gradient";

describe("cssGradientPoints", () => {
  it("180deg runs top to bottom through the centre", () => {
    const p = cssGradientPoints(180, 100, 50);
    expect(p.start.x).toBeCloseTo(50);
    expect(p.start.y).toBeCloseTo(0);
    expect(p.end.x).toBeCloseTo(50);
    expect(p.end.y).toBeCloseTo(50);
  });
  it("135deg on a square runs corner to corner", () => {
    const p = cssGradientPoints(135, 100, 100);
    expect(p.start.x).toBeCloseTo(0);
    expect(p.start.y).toBeCloseTo(0);
    expect(p.end.x).toBeCloseTo(100);
    expect(p.end.y).toBeCloseTo(100);
  });
  it("135deg on a wide button keeps the CSS gradient-line length (w + h)·√½", () => {
    const p = cssGradientPoints(135, 176, 62);
    expect(Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y)).toBeCloseTo((176 + 62) * Math.SQRT1_2);
  });
  it("passes through the centre of the box", () => {
    const p = cssGradientPoints(135, 176, 62);
    expect((p.start.x + p.end.x) / 2).toBeCloseTo(88);
    expect((p.start.y + p.end.y) / 2).toBeCloseTo(31);
  });
});
