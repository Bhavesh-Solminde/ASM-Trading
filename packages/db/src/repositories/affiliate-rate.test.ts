import { describe, expect, it } from "vitest";
import { revenueShareEffectiveFrom } from "./affiliate-rate";

describe("Revenue Share effective dates", () => {
  it("starts an intraday change at the next IST midnight, across year boundaries", () => {
    expect(revenueShareEffectiveFrom(new Date("2026-12-31T10:00:00Z")).toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(revenueShareEffectiveFrom(new Date("2026-12-31T18:30:00.001Z")).toISOString()).toBe("2027-01-01T18:30:00.000Z");
  });
  it("preserves a requested IST midnight exactly", () => {
    expect(revenueShareEffectiveFrom(new Date("2026-11-17T18:30:00Z")).toISOString()).toBe("2026-11-17T18:30:00.000Z");
  });
});
