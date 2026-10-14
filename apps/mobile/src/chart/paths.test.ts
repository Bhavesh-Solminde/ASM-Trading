import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import { buildSeries } from "./paths";
import type { ChartType, PriceRange, Viewport } from "./types";

const vp: Viewport = { width: 100, height: 100, rightIndex: 2, visibleCount: 2 };
const range: PriceRange = { min: 0, max: 10 };
const candles: CandleDto[] = [
  { openTs: 0, o: 2, h: 8, l: 1, c: 6 }, // up
  { openTs: 60, o: 6, h: 7, l: 3, c: 4 }, // down
];
const TYPES: ChartType[] = ["candles", "line", "area", "bars"];

describe("buildSeries", () => {
  it("splits candles into up and down paths with wick and body", () => {
    const s = buildSeries("candles", candles, 0, 2, vp, range);
    expect(s.up).toContain("M");
    expect(s.down).toContain("M");
    expect(s.up).not.toBe(s.down);
  });

  it("draws a line through the closes", () => {
    const s = buildSeries("line", candles, 0, 2, vp, range);
    expect(s.line).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
  });

  it("closes the area path to the bottom of the chart", () => {
    const s = buildSeries("area", candles, 0, 2, vp, range);
    expect(s.area?.endsWith("Z")).toBe(true);
  });

  it("draws OHLC bars with open and close ticks", () => {
    const s = buildSeries("bars", candles, 0, 2, vp, range);
    expect((s.up.match(/M/g) ?? []).length).toBe(3);
  });

  it("returns empty paths for an empty window", () => {
    expect(buildSeries("candles", [], 0, 0, vp, range)).toEqual({ up: "", down: "" });
  });

  it.each(TYPES)("%s never draws candle index `to` (the forming candle)", (type) => {
    // Only candle 0 is inside [0, 1). Changing candle 1 (= `to`) must not change any path.
    const withForming: CandleDto[] = [candles[0]!, { openTs: 60, o: 1, h: 10, l: 0, c: 9 }];
    const withOtherForming: CandleDto[] = [candles[0]!, { openTs: 60, o: 5, h: 5.5, l: 4.5, c: 5.2 }];
    expect(buildSeries(type, withForming, 0, 1, vp, range)).toEqual(
      buildSeries(type, withOtherForming, 0, 1, vp, range),
    );
  });
});
