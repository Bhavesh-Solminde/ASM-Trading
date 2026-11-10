import { describe, expect, it } from "vitest";
import { MONTH_KEYS, whenParts } from "./when";

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).getTime();

describe("whenParts", () => {
  it("is the local day, month (0-based) and a 24-hour time, no year in the current year", () => {
    expect(whenParts(at(2026, 9, 21, 10, 32), at(2026, 9, 30, 9, 0))).toEqual({ day: 21, month: 9, year: null, time: "10:32" });
  });
  it("zero-pads the time", () => {
    expect(whenParts(at(2026, 0, 3, 0, 5), at(2026, 9, 30, 9, 0)).time).toBe("00:05");
    expect(whenParts(at(2026, 0, 3, 9, 0), at(2026, 9, 30, 9, 0)).time).toBe("09:00");
  });
  it("adds the year for another year", () => {
    expect(whenParts(at(2025, 11, 31, 23, 59), at(2026, 0, 1, 0, 1))).toEqual({ day: 31, month: 11, year: 2025, time: "23:59" });
  });
});

describe("MONTH_KEYS", () => {
  it("names the twelve months in order", () => {
    expect(MONTH_KEYS).toHaveLength(12);
    expect(MONTH_KEYS[0]).toBe("jan");
    expect(MONTH_KEYS[11]).toBe("dec");
  });
});
