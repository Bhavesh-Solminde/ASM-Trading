import { describe, expect, it } from "vitest";
import { isOtcMarketClosed } from "./schedule";

/**
 * IST is UTC+05:30. To pin a specific IST wall-clock time in a Date, subtract
 * 5h30 from the UTC parts. `Date.UTC(...)` returns ms since epoch matching the
 * wall-clock time on the UTC line — we adjust it so the equivalent IST wall
 * clock matches the values we want.
 */
function istMs(hourIst: number, minuteIst: number): number {
  return Date.UTC(2026, 8, 24, hourIst - 5, minuteIst - 30);
}

describe("isOtcMarketClosed", () => {
  it("is CLOSED at 23:30 IST exactly (window inclusive on the close edge)", () => {
    expect(isOtcMarketClosed(istMs(23, 30))).toBe(true);
  });

  it("is CLOSED at midnight IST (wrap case)", () => {
    expect(isOtcMarketClosed(istMs(0, 0))).toBe(true);
    expect(isOtcMarketClosed(istMs(2, 15))).toBe(true);
    expect(isOtcMarketClosed(istMs(4, 59))).toBe(true);
  });

  it("is OPEN at 05:00 IST exactly (window exclusive on the open edge)", () => {
    expect(isOtcMarketClosed(istMs(5, 0))).toBe(false);
  });

  it("is OPEN through the trading day (05:00 → 23:29 IST)", () => {
    expect(isOtcMarketClosed(istMs(5, 0))).toBe(false);
    expect(isOtcMarketClosed(istMs(9, 30))).toBe(false);
    expect(isOtcMarketClosed(istMs(15, 45))).toBe(false);
    expect(isOtcMarketClosed(istMs(23, 29))).toBe(false);
  });
});
