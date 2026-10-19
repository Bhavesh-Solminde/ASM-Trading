import { describe, expect, it } from "vitest";
import { clockHm, marketReopensAt } from "./market-hours";

// IST is UTC+05:30: 2026-10-14 23:45 IST = 18:15 UTC.
const ist = (h: number, m: number, day = 14) => Date.UTC(2026, 9, day, h, m) - 19_800_000;

describe("marketReopensAt", () => {
  it("is null for crypto and forex at any hour", () => {
    expect(marketReopensAt("BTCUSDT", ist(2, 0))).toBeNull();
    expect(marketReopensAt("EURUSD", ist(23, 45))).toBeNull();
  });
  it("is null for an India index during the day", () => {
    expect(marketReopensAt("NIFTY50", ist(10, 0))).toBeNull();
    expect(marketReopensAt("NIFTY50", ist(5, 0))).toBeNull(); // opens exactly at 05:00
    expect(marketReopensAt("NIFTY50", ist(23, 29))).toBeNull();
  });
  it("is the next 05:00 IST while an India index is closed (23:30 to 05:00)", () => {
    expect(marketReopensAt("BANKNIFTY", ist(23, 30))).toBe(ist(5, 0, 15));
    expect(marketReopensAt("BANKNIFTY", ist(23, 45))).toBe(ist(5, 0, 15));
    expect(marketReopensAt("SENSEX", ist(0, 10, 15))).toBe(ist(5, 0, 15));
    expect(marketReopensAt("SENSEX", ist(4, 59, 15))).toBe(ist(5, 0, 15));
  });
});

describe("clockHm", () => {
  it("formats device-local HH:MM, zero-padded", () => {
    expect(clockHm(new Date(2026, 9, 15, 5, 0).getTime())).toBe("05:00");
    expect(clockHm(new Date(2026, 9, 15, 14, 7).getTime())).toBe("14:07");
  });
});
