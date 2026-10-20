import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandleDto } from "@asm/contracts";
import {
  HISTORY_INTERVAL_MS,
  HistoryFlusher,
  commitOnKeyChange,
  firstCandleShift,
  frontChanged,
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

describe("frontChanged", () => {
  it("treats two empty lists as unchanged (the render-phase loop guard)", () => {
    expect(frontChanged([], [])).toBe(false);
  });
  it("detects the first candle appearing or disappearing", () => {
    expect(frontChanged([], [c(0)])).toBe(true);
    expect(frontChanged([c(0)], [])).toBe(true);
  });
  it("ignores a new array with the same first candle", () => {
    expect(frontChanged([c(0)], [c(0), c(60)])).toBe(false);
  });
  it("detects a different first candle", () => {
    expect(frontChanged([c(60)], [c(0), c(60)])).toBe(true);
    expect(frontChanged([c(0)], [c(60)])).toBe(true);
  });
});

describe("commitOnKeyChange", () => {
  const candles = [c(0)];
  const prev = { range: R1, key: ["a", candles] as readonly unknown[] };
  it("commits the live range immediately when a structural input changed", () => {
    expect(commitOnKeyChange(prev, R2, ["b", candles])).toEqual({ range: R2, key: ["b", candles] });
  });
  it("returns the same object when the key is unchanged, even if the range moved", () => {
    expect(commitOnKeyChange(prev, R2, ["a", candles])).toBe(prev);
  });
});

describe("HistoryFlusher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes a held-back range within the interval", () => {
    const flush = vi.fn();
    new HistoryFlusher().schedule(R1, 0, R2, 0, flush);
    vi.advanceTimersByTime(HISTORY_INTERVAL_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("is not postponed by a continuous stream of ticks", () => {
    const flush = vi.fn();
    const f = new HistoryFlusher();
    for (let t = 0; t < HISTORY_INTERVAL_MS; t += 25) {
      f.schedule(R1, 0, { min: 1, max: 2 + t }, t, flush);
      vi.advanceTimersByTime(25);
    }
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing when the range is unchanged", () => {
    const flush = vi.fn();
    new HistoryFlusher().schedule(R1, 0, { ...R1 }, 0, flush);
    vi.advanceTimersByTime(10_000);
    expect(flush).not.toHaveBeenCalled();
  });

  it("can schedule again after a flush and after cancel (StrictMode remount)", () => {
    const flush = vi.fn();
    const f = new HistoryFlusher();
    f.schedule(R1, 0, R2, 0, flush);
    vi.advanceTimersByTime(HISTORY_INTERVAL_MS);
    f.schedule(R1, 0, R2, HISTORY_INTERVAL_MS, flush);
    f.cancel();
    vi.advanceTimersByTime(10_000);
    expect(flush).toHaveBeenCalledTimes(1);
    f.schedule(R1, 0, R2, 0, flush);
    vi.advanceTimersByTime(HISTORY_INTERVAL_MS);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
