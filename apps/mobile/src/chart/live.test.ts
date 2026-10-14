import { describe, expect, it } from "vitest";
import type { CandleDto } from "@asm/contracts";
import {
  HISTORY_INTERVAL_MS,
  historyRetryDelay,
  isFollowing,
  nextHistoryRange,
  prependedCount,
  shouldRequestOlder,
  type HistoryCommit,
} from "./live";

const R1 = { min: 1, max: 2 };
const R2 = { min: 1, max: 3 };
const c = (openTs: number): CandleDto => ({ openTs, o: 1, h: 2, l: 0, c: 1 });

describe("nextHistoryRange", () => {
  it("commits the first range immediately", () => {
    expect(nextHistoryRange(null, R1, ["a"], 1000)).toEqual({ range: R1, key: ["a"], at: 1000 });
  });

  it("holds the committed range when only the range changed inside the interval", () => {
    const prev: HistoryCommit = { range: R1, key: ["a"], at: 1000 };
    expect(nextHistoryRange(prev, R2, ["a"], 1000 + HISTORY_INTERVAL_MS - 1)).toBe(prev);
  });

  it("commits a changed range once the interval has elapsed", () => {
    const prev: HistoryCommit = { range: R1, key: ["a"], at: 1000 };
    expect(nextHistoryRange(prev, R2, ["a"], 1000 + HISTORY_INTERVAL_MS)).toEqual({
      range: R2,
      key: ["a"],
      at: 1000 + HISTORY_INTERVAL_MS,
    });
  });

  it("commits immediately when a structural input changed (pan, zoom, new candle)", () => {
    const prev: HistoryCommit = { range: R1, key: ["a", 1], at: 1000 };
    expect(nextHistoryRange(prev, R2, ["a", 2], 1001)).toEqual({ range: R2, key: ["a", 2], at: 1001 });
  });

  it("compares key entries by identity (a new candles array is a change)", () => {
    const a = [c(0)];
    const prev: HistoryCommit = { range: R1, key: [a], at: 1000 };
    expect(nextHistoryRange(prev, R1, [a], 1001)).toBe(prev);
    expect(nextHistoryRange(prev, R1, [[c(0)]], 1001).at).toBe(1001);
  });

  it("keeps the same commit object when nothing changed", () => {
    const prev: HistoryCommit = { range: R1, key: ["a"], at: 1000 };
    expect(nextHistoryRange(prev, { ...R1 }, ["a"], 5000)).toBe(prev);
  });
});

describe("historyRetryDelay", () => {
  const prev: HistoryCommit = { range: R1, key: ["a"], at: 1000 };
  it("is null when the live range equals the committed one", () => {
    expect(historyRetryDelay(prev, { ...R1 }, 1100)).toBeNull();
  });
  it("is the time left until the interval elapses", () => {
    expect(historyRetryDelay(prev, R2, 1100)).toBe(HISTORY_INTERVAL_MS - 100);
  });
  it("is 0 when already due", () => {
    expect(historyRetryDelay(prev, R2, 9000)).toBe(0);
  });
});

describe("prependedCount", () => {
  it("counts the candles added before the previously-first candle", () => {
    expect(prependedCount(120, [c(0), c(60), c(120), c(180)])).toBe(2);
  });
  it("is 0 when the first candle did not move", () => {
    expect(prependedCount(0, [c(0), c(60)])).toBe(0);
  });
  it("is 0 for a first load, an emptied list, or a first candle that is not in the new list", () => {
    expect(prependedCount(null, [c(0)])).toBe(0);
    expect(prependedCount(60, [])).toBe(0);
    expect(prependedCount(30, [c(0), c(60)])).toBe(0);
  });
  it("is 0 when the first candle moved later (trimmed)", () => {
    expect(prependedCount(0, [c(60), c(120)])).toBe(0);
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
