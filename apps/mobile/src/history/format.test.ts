import { describe, expect, it } from "vitest";
import { headingText, whenText } from "./format";

/** A `t` that shows which key and values it was given. */
const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key);
const at = (y: number, m: number, d: number, h = 10, min = 32) => new Date(y, m, d, h, min).getTime();
const now = at(2026, 9, 30, 9, 0);

describe("headingText", () => {
  it("words today and yesterday", () => {
    expect(headingText(t, { kind: "today" })).toBe("history.day.today");
    expect(headingText(t, { kind: "yesterday" })).toBe("history.day.yesterday");
  });
  it("words a date with the translated month, and the year only when given", () => {
    expect(headingText(t, { kind: "date", day: 12, month: 9, year: null })).toBe("history.day.date(day=12,month=history.month.oct)");
    expect(headingText(t, { kind: "date", day: 31, month: 11, year: 2025 })).toBe("history.day.dateYear(day=31,month=history.month.dec,year=2025)");
  });
});

describe("whenText", () => {
  it("joins the date and the 24-hour time", () => {
    expect(whenText(t, at(2026, 9, 21), now)).toBe("history.when(date=history.day.date(day=21,month=history.month.oct),time=10:32)");
  });
  it("includes the year for another year", () => {
    expect(whenText(t, at(2025, 0, 2), now)).toContain("history.day.dateYear(day=2,month=history.month.jan,year=2025)");
  });
});
