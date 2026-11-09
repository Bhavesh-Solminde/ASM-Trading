import { describe, expect, it } from "vitest";
import { startOfDayMs } from "./day";

describe("startOfDayMs", () => {
  it("returns the most recent IST midnight for a mid-day time", () => {
    // 2026-09-21T12:00:00Z = 17:30 IST on the 21st → midnight = 2026-09-20T18:30:00Z.
    const now = Date.parse("2026-09-21T12:00:00Z");
    const start = startOfDayMs(now, "Asia/Kolkata");
    expect(new Date(start).toISOString()).toBe("2026-09-20T18:30:00.000Z");
    expect(start).toBeLessThanOrEqual(now);
  });

  it("is idempotent-ish: the boundary itself maps to itself", () => {
    const now = Date.parse("2026-09-21T12:00:00Z");
    const start = startOfDayMs(now, "Asia/Kolkata");
    expect(startOfDayMs(start, "Asia/Kolkata")).toBe(start);
  });

  it("handles a time just after IST midnight", () => {
    // 2026-09-20T18:31:00Z = 00:01 IST on the 21st → midnight = 2026-09-20T18:30:00Z.
    const now = Date.parse("2026-09-20T18:31:00Z");
    expect(new Date(startOfDayMs(now, "Asia/Kolkata")).toISOString()).toBe("2026-09-20T18:30:00.000Z");
  });
});
