import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import { entryIndex, gridYs, hasNonAscii, priceTagRect, readoutBox, showReadout, tradeTagRect } from "./tag-layout";

const c = (openTs: number): CandleDto => ({ openTs, o: 1, h: 1, l: 1, c: 1 });

describe("priceTagRect", () => {
  it("sits 4 from the right edge of the axis and grows leftwards with the text (may overlap the plot)", () => {
    // plot 300 + axis 56: right edge at 356
    expect(priceTagRect(300, 56, 60)).toEqual({ x: 280, w: 72, textX: 286 });
  });
});

describe("tradeTagRect", () => {
  it("ends 4 before the plot's right edge, text inset 6 from its left", () => {
    expect(tradeTagRect(300, 80)).toEqual({ x: 204, w: 92, textX: 210 });
  });
});

describe("entryIndex", () => {
  const all = [c(100), c(160), c(220), c(280)];
  it("is the candle whose period holds the entry time", () => {
    expect(entryIndex(all, 160)).toBe(1);
    expect(entryIndex(all, 219)).toBe(1);
    expect(entryIndex(all, 230)).toBe(2);
  });
  it("is the forming (last) candle for a time after it opened", () => {
    expect(entryIndex(all, 999)).toBe(3);
  });
  it("is -1 before the first candle (caller clamps x to 0) and for an empty list", () => {
    expect(entryIndex(all, 50)).toBe(-1);
    expect(entryIndex([], 50)).toBe(-1);
  });
});

describe("gridYs", () => {
  it("is three rules evenly spaced over the plot height", () => {
    expect(gridYs(400)).toEqual([100, 200, 300]);
  });
});

describe("readoutBox", () => {
  it("starts at the inset (below the overlay row) and keeps clear of the price tags on the right", () => {
    expect(readoutBox(58, 56)).toEqual({ top: 58, left: 6, right: 62 });
  });
  it("never goes above the chart or takes a negative inset", () => {
    expect(readoutBox(-5, 56).top).toBe(0);
    expect(readoutBox(Number.NaN, 56).top).toBe(0);
  });
});

describe("showReadout", () => {
  it("needs a candle under the crosshair and the tools panel closed", () => {
    expect(showReadout({ hide: false, hasCandle: true })).toBe(true);
    expect(showReadout({ hide: true, hasCandle: true })).toBe(false);
    expect(showReadout({ hide: false, hasCandle: false })).toBe(false);
  });
});

describe("hasNonAscii", () => {
  it("is false for Latin tag text and true when a Hindi word or the ellipsis is in it", () => {
    expect(hasNonAscii("Down 0:08")).toBe(false);
    expect(hasNonAscii("94,553.62")).toBe(false);
    expect(hasNonAscii("नीचे 0:08")).toBe(true);
    expect(hasNonAscii("Down Settling…")).toBe(true);
  });
});
