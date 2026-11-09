import { describe, expect, it } from "vitest";
import { ledgerStamp } from "./closed-stamp";

describe("ledgerStamp", () => {
  const now = new Date(2026, 9, 14, 18, 30).getTime();
  it("is HH:MM for today", () => {
    expect(ledgerStamp(new Date(2026, 9, 14, 18, 10, 42).getTime() / 1000, now)).toEqual({ time: "18:10", date: null });
  });
  it("adds dd/mm for an earlier day", () => {
    expect(ledgerStamp(new Date(2026, 9, 12, 9, 5).getTime() / 1000, now)).toEqual({ time: "09:05", date: "12/10" });
  });
  it("zero-pads a midnight-hour close", () => {
    expect(ledgerStamp(new Date(2026, 0, 2, 0, 0, 0).getTime() / 1000, now)).toEqual({ time: "00:00", date: "02/01" });
  });
});
