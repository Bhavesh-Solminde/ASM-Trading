import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import { buildSeries } from "./paths";
import type { ChartType, PriceRange, Viewport } from "./types";

// 100x100 canvas, 2 visible candles => 50px per candle; candle 0 centred at x=25, candle 1 at x=75.
// Price 0..10 over 100px => y = (10 - price) * 10. Body half-width = 0.35 * 50 = 17.5.
const vp: Viewport = { width: 100, height: 100, rightIndex: 2, visibleCount: 2 };
const range: PriceRange = { min: 0, max: 10 };
const candles: CandleDto[] = [
  { openTs: 0, o: 2, h: 8, l: 1, c: 6 }, // up
  { openTs: 60, o: 6, h: 7, l: 3, c: 4 }, // down
];
const TYPES: ChartType[] = ["candles", "line", "area", "bars"];

describe("buildSeries", () => {
  it("draws candles: wick and body for the up candle, body for the down candle", () => {
    const s = buildSeries("candles", candles, 0, 2, vp, range);
    expect(s.up).toBe("M25 20 L25 90 M7.5 40 L42.5 40 L42.5 80 L7.5 80 Z");
    expect(s.down).toBe("M75 30 L75 70 M57.5 40 L92.5 40 L92.5 60 L57.5 60 Z");
  });

  it("draws a doji (close === open) in the up path with a 1px body", () => {
    const doji: CandleDto[] = [{ openTs: 0, o: 5, h: 6, l: 4, c: 5 }];
    const s = buildSeries("candles", doji, 0, 1, vp, range);
    expect(s.up).toBe("M25 40 L25 60 M7.5 50 L42.5 50 L42.5 51 L7.5 51 Z");
    expect(s.down).toBe("");
  });

  it("draws bars: wick plus open tick (left) and close tick (right)", () => {
    const s = buildSeries("bars", candles, 0, 2, vp, range);
    expect(s.up).toBe("M25 20 L25 90 M7.5 80 L25 80 M25 40 L42.5 40");
    expect(s.down).toBe("M75 30 L75 70 M57.5 40 L75 40 M75 60 L92.5 60");
  });

  it("draws a line through the closes", () => {
    const s = buildSeries("line", candles, 0, 2, vp, range);
    expect(s.line).toBe("M25 40 L75 60");
    expect(s.area).toBeUndefined();
  });

  it("closes the area path down to the bottom of the chart", () => {
    const s = buildSeries("area", candles, 0, 2, vp, range);
    expect(s.line).toBe("M25 40 L75 60");
    expect(s.area).toBe("M25 40 L75 60 L75 100 L25 100 Z");
  });

  it("honours `from`: from=1 draws only candle 1", () => {
    const s = buildSeries("candles", candles, 1, 2, vp, range);
    expect(s.up).toBe("");
    expect(s.down).toBe("M75 30 L75 70 M57.5 40 L92.5 40 L92.5 60 L57.5 60 Z");
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

describe("buildSeries wicks", () => {
  it("splits candle wicks from bodies so bodies can be filled and wicks stroked", () => {
    const s = buildSeries("candles", candles, 0, 2, vp, range);
    expect(s.upWicks).toBe("M25 20 L25 90");
    expect(s.downWicks).toBe("M75 30 L75 70");
  });

  it("has no wick fields for bars, lines or areas", () => {
    for (const type of ["bars", "line", "area"] as ChartType[]) {
      const s = buildSeries(type, candles, 0, 2, vp, range);
      expect(s.upWicks).toBeUndefined();
      expect(s.downWicks).toBeUndefined();
    }
  });
});
