import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import {
  clampVisible,
  indexForX,
  nearLeftEdge,
  panBy,
  priceForY,
  priceRange,
  shiftForPrepend,
  visibleRange,
  xForIndex,
  yForPrice,
  zoomAround,
} from "./scale";

const vp = { width: 300, height: 200, rightIndex: 100, visibleCount: 50 };
const candle = (i: number, l: number, h: number): CandleDto => ({ openTs: i * 60, o: l, h, l, c: h });

describe("scale", () => {
  it("clamps zoom between 15 and 300 candles", () => {
    expect(clampVisible(5)).toBe(15);
    expect(clampVisible(1000)).toBe(300);
  });

  it("maps the right edge to the right side of the canvas", () => {
    expect(xForIndex(100, vp)).toBe(300);
    expect(xForIndex(50, vp)).toBe(0);
    expect(indexForX(150, vp)).toBe(75);
  });

  it("returns the integer window of visible candles", () => {
    expect(visibleRange(vp, 100)).toEqual({ from: 50, to: 100 });
    expect(visibleRange({ ...vp, rightIndex: 30 }, 100)).toEqual({ from: 0, to: 30 });
  });

  it("pads the visible high/low by 8% and includes extra prices", () => {
    const r = priceRange([candle(0, 10, 20)], 0, 1);
    expect(r.min).toBeCloseTo(9.2);
    expect(r.max).toBeCloseTo(20.8);
    expect(priceRange([candle(0, 10, 20)], 0, 1, [30]).max).toBeGreaterThan(30);
  });

  it("puts higher prices nearer the top", () => {
    const r = { min: 0, max: 100 };
    expect(yForPrice(100, r, 200)).toBe(0);
    expect(yForPrice(0, r, 200)).toBe(200);
  });

  it("zooms around the finger, keeping the price under it in place", () => {
    const z = zoomAround(vp, 150, 2, 100);
    expect(z.visibleCount).toBe(25);
    expect(indexForX(150, z)).toBeCloseTo(indexForX(150, vp));
  });

  it("pans back in time and never past the live edge", () => {
    expect(panBy(vp, 60, 100).rightIndex).toBeCloseTo(90);
    expect(panBy(vp, -600, 100).rightIndex).toBe(100);
  });

  it("detects when the user is near the oldest loaded candle", () => {
    expect(nearLeftEdge({ ...vp, rightIndex: 60 }, 100)).toBe(true);
    expect(nearLeftEdge(vp, 100)).toBe(false);
  });

  it("keeps the same candles in place when older candles are prepended", () => {
    const shifted = shiftForPrepend(vp, 10);
    expect(shifted.rightIndex).toBe(110);
    expect(shifted.visibleCount).toBe(vp.visibleCount);
    // an existing candle at old index 40 now sits at index 50 in the prepended array
    expect(xForIndex(50, shifted)).toBeCloseTo(xForIndex(40, vp));
  });

  it("never pans the live edge past a history shorter than the minimum window", () => {
    for (const dx of [-600, -1, 0, 1, 600]) {
      expect(panBy(vp, dx, 3).rightIndex).toBeLessThanOrEqual(3);
    }
    expect(panBy(vp, 600, 3).rightIndex).toBe(3);
  });

  it("maps a price to a pixel row and back (priceForY inverts yForPrice)", () => {
    const r = { min: 0, max: 100 };
    expect(priceForY(yForPrice(37.5, r, 200), r, 200)).toBeCloseTo(37.5);
    expect(priceForY(0, r, 200)).toBe(100);
  });

  it("gives a flat price range (single candle with h === l) a non-zero span", () => {
    const r = priceRange([candle(0, 5, 5)], 0, 1);
    expect(r.max).toBeGreaterThan(r.min);
    expect(Number.isFinite(yForPrice(5, r, 200))).toBe(true);
  });

  it("gives an all-zero price range a non-zero span", () => {
    const r = priceRange([candle(0, 0, 0)], 0, 1);
    expect(r.max).toBeGreaterThan(r.min);
    expect(Number.isFinite(yForPrice(0, r, 200))).toBe(true);
  });

  it("returns the viewport unchanged when zoom or pan inputs are unusable", () => {
    const zeroWidth = { ...vp, width: 0 };
    expect(zoomAround(zeroWidth, 10, 2, 100)).toBe(zeroWidth);
    expect(zoomAround(vp, NaN, 2, 100)).toBe(vp);
    expect(zoomAround(vp, 150, Infinity, 100)).toBe(vp);
    expect(zoomAround(vp, 150, 2, NaN)).toBe(vp);
    expect(panBy({ ...vp, width: -1 }, 10, 100)).toEqual({ ...vp, width: -1 });
    expect(panBy(vp, Infinity, 100)).toBe(vp);
    expect(panBy(vp, 10, NaN)).toBe(vp);
  });
});
