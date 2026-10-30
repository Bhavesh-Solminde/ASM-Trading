import { describe, expect, it } from "vitest";
import { dayHeading } from "./day-label";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const now = at(2026, 9, 21, 15);

describe("dayHeading", () => {
  it("names today and yesterday", () => {
    expect(dayHeading(at(2026, 9, 21, 0), now)).toEqual({ kind: "today" });
    expect(dayHeading(at(2026, 9, 20, 23), now)).toEqual({ kind: "yesterday" });
  });
  it("gives day and month (0-based) for an older day this year, no year", () => {
    expect(dayHeading(at(2026, 9, 12), now)).toEqual({ kind: "date", day: 12, month: 9, year: null });
    expect(dayHeading(at(2026, 0, 1), now)).toEqual({ kind: "date", day: 1, month: 0, year: null });
  });
  it("adds the year for another year", () => {
    expect(dayHeading(at(2025, 11, 31), now)).toEqual({ kind: "date", day: 31, month: 11, year: 2025 });
  });
  it("rolls yesterday over a month boundary", () => {
    expect(dayHeading(at(2026, 8, 30), at(2026, 9, 1, 1))).toEqual({ kind: "yesterday" });
  });
});
