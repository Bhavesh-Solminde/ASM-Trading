import { describe, expect, it } from "vitest";
import { affiliateAllTime, affiliateMonth, statisticsPeriod } from "./server";

const now = new Date("2028-02-29T18:30:00.000Z");
const createdAt = new Date("2028-01-12T20:00:00.000Z");
const tomorrow = new Date("2028-03-01T18:30:00.000Z");

describe("Affiliate Center IST ranges", () => {
  it("rolls over at IST midnight even when the UTC month has not changed", () => {
    expect(affiliateMonth(now)).toEqual({ from: now, to: tomorrow });
    expect(affiliateAllTime(createdAt, now)).toEqual({
      from: new Date("2028-01-12T18:30:00.000Z"),
      to: tomorrow,
    });
  });

  it("includes the custom end day and accepts a valid leap day", () => {
    const result = statisticsPeriod({ period: "custom", from: "2028-02-29", to: "2028-03-01" }, createdAt, now);
    expect(result.error).toBeUndefined();
    expect(result.range).toEqual({ from: new Date("2028-02-28T18:30:00.000Z"), to: tomorrow });
  });

  it.each([
    { from: "", to: "2028-03-01" },
    { from: "2028-02-30", to: "2028-03-01" },
    { from: "2028-03-01", to: "2028-02-28" },
    { from: "2028-02-28", to: "2028-03-02" },
  ])("falls back to the last seven days for custom dates $from to $to", (dates) => {
    const result = statisticsPeriod({ period: "custom", ...dates }, createdAt, now);
    expect(result).toMatchObject({
      period: "custom",
      from: "2028-02-24",
      to: "2028-03-01",
      error: "Choose a start and end date in order, up to today. Showing the last 7 days.",
      range: { from: new Date("2028-02-23T18:30:00.000Z"), to: tomorrow },
    });
  });
});
