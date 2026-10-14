import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import {
  HISTORY_INTERVAL_MS,
  firstCandleShift,
  historyRetryDelay,
  isFollowing,
  isSameKey,
  shouldRequestOlder,
  startViewport,
} from "./live";
import { panBy, zoomAround } from "./scale";
import type { Viewport } from "./types";

const R1 = { min: 1, max: 2 };
const R2 = { min: 1, max: 3 };
const c = (openTs: number): CandleDto => ({ openTs, o: 1, h: 2, l: 0, c: 1 });

describe("isSameKey", () => {
  it("compares entries by identity", () => {
    const candles = [c(0)];
    expect(isSameKey(["a", candles, 1], ["a", candles, 1])).toBe(true);
    expect(isSameKey(["a", candles], ["a", [c(0)]])).toBe(false);
    expect(isSameKey(["a"], ["a", 1])).toBe(false);
  });
});

describe("historyRetryDelay", () => {
  it("is null when the live range equals the committed one", () => {
    expect(historyRetryDelay(R1, 1000, { ...R1 }, 1100)).toBeNull();
  });
  it("is the time left until the interval elapses", () => {
    expect(historyRetryDelay(R1, 1000, R2, 1100)).toBe(HISTORY_INTERVAL_MS - 100);
  });
  it("is 0 when already due", () => {
    expect(historyRetryDelay(R1, 1000, R2, 9000)).toBe(0);
  });
});

describe("firstCandleShift", () => {
  it("is the number of candles prepended", () => {
    expect(firstCandleShift([c(120), c(180)], [c(0), c(60), c(120), c(180), c(240)])).toBe(2);
  });
  it("is negative when the front was trimmed", () => {
    expect(firstCandleShift([c(0), c(60), c(120)], [c(60), c(120), c(180)])).toBe(-1);
    expect(firstCandleShift([c(0), c(60), c(120), c(180)], [c(120), c(180), c(240)])).toBe(-2);
  });
  it("is 0 when the first candle did not move", () => {
    expect(firstCandleShift([c(0), c(60)], [c(0), c(60), c(120)])).toBe(0);
  });
  it("is 0 for a first load, an emptied list, or lists that do not overlap", () => {
    expect(firstCandleShift([], [c(0)])).toBe(0);
    expect(firstCandleShift([c(60)], [])).toBe(0);
    expect(firstCandleShift([c(30), c(90)], [c(0), c(60)])).toBe(0);
    expect(firstCandleShift([c(0), c(60)], [c(30), c(90)])).toBe(0);
  });
});

describe("startViewport", () => {
  const start: Viewport = { width: 300, height: 200, rightIndex: 100, visibleCount: 60 };
  const total = 100;

  it("is unchanged when no shift landed during the gesture", () => {
    expect(startViewport(start, 5, 5)).toEqual(start);
  });

  it("panning after a prepend shows the same candles as panning without it", () => {
    const n = 40;
    const plain = panBy(start, 80, total);
    const shifted = panBy(startViewport(start, 0, n), 80, total + n);
    expect(shifted.rightIndex).toBeCloseTo(plain.rightIndex + n, 9);
    expect(shifted.visibleCount).toBe(plain.visibleCount);
  });

  it("zooming after a prepend keeps the same candle under the focus", () => {
    const n = 40;
    const plain = zoomAround(start, 150, 1.5, total);
    const shifted = zoomAround(startViewport(start, 0, n), 150, 1.5, total + n);
    expect(shifted.rightIndex).toBeCloseTo(plain.rightIndex + n, 9);
  });

  it("only counts the shift since the gesture began, and handles a trim", () => {
    expect(startViewport(start, 40, 40).rightIndex).toBe(100);
    expect(startViewport(start, 40, 30).rightIndex).toBe(90);
  });
});

describe("shouldRequestOlder", () => {
  const out = { near: false, firstTs: 100 };
  it("fires on the transition into the near-left zone", () => {
    expect(shouldRequestOlder(out, { near: true, firstTs: 100 })).toBe(true);
  });
  it("does not fire on every frame while staying in the zone", () => {
    expect(shouldRequestOlder({ near: true, firstTs: 100 }, { near: true, firstTs: 100 })).toBe(false);
  });
  it("fires again after older candles arrived and the view is still near the edge", () => {
    expect(shouldRequestOlder({ near: true, firstTs: 100 }, { near: true, firstTs: 40 })).toBe(true);
  });
  it("does not fire when outside the zone or with no candles", () => {
    expect(shouldRequestOlder({ near: true, firstTs: 100 }, { near: false, firstTs: 100 })).toBe(false);
    expect(shouldRequestOlder(out, { near: true, firstTs: null })).toBe(false);
  });
});

describe("isFollowing", () => {
  it("follows within half a candle of the live edge", () => {
    expect(isFollowing(10, 10)).toBe(true);
    expect(isFollowing(9.5, 10)).toBe(true);
    expect(isFollowing(9.4, 10)).toBe(false);
  });
});
