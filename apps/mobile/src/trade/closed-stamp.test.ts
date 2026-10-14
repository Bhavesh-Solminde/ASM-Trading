import { describe, expect, it } from "vitest";
import { closedStamp } from "./closed-stamp";

const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const NOW = new Date(2026, 9, 14, 18, 30, 0);

describe("closedStamp", () => {
  it("shows just the clock time for a trade that closed today", () => {
    expect(closedStamp(sec(new Date(2026, 9, 14, 9, 5, 7)), NOW.getTime())).toBe("09:05:07");
  });
  it("adds the day and month when it closed on an earlier day", () => {
    expect(closedStamp(sec(new Date(2026, 9, 13, 23, 59, 1)), NOW.getTime())).toBe("13/10 23:59:01");
    expect(closedStamp(sec(new Date(2026, 0, 2, 0, 0, 0)), NOW.getTime())).toBe("02/01 00:00:00");
  });
});
