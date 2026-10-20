import { describe, expect, it } from "vitest";
import { LOCK_AFTER_MS, MAX_PIN_ATTEMPTS, nextAttempt, parseAttempts, shouldLock } from "./rules";

const now = 1_000_000_000;

describe("shouldLock", () => {
  it("locks on a cold start when the lock is on", () => {
    expect(shouldLock({ enabled: true, coldStart: true, backgroundedAt: null, now })).toBe(true);
  });
  it("locks after five minutes in the background", () => {
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - LOCK_AFTER_MS, now })).toBe(true);
  });
  it("stays unlocked after a short trip to another app", () => {
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - 60_000, now })).toBe(false);
  });
  it("never locks when the user turned the lock off", () => {
    expect(shouldLock({ enabled: false, coldStart: true, backgroundedAt: null, now })).toBe(false);
  });
});

describe("nextAttempt", () => {
  it("counts a wrong PIN without logging out before the limit", () => {
    expect(nextAttempt(0)).toEqual({ attempts: 1, logout: false });
    expect(nextAttempt(MAX_PIN_ATTEMPTS - 2)).toEqual({ attempts: MAX_PIN_ATTEMPTS - 1, logout: false });
  });
  it("logs out on the fifth wrong PIN", () => {
    expect(nextAttempt(MAX_PIN_ATTEMPTS - 1)).toEqual({ attempts: MAX_PIN_ATTEMPTS, logout: true });
  });
  it("still logs out if the stored count is already past the limit", () => {
    expect(nextAttempt(MAX_PIN_ATTEMPTS + 3).logout).toBe(true);
  });
});

describe("parseAttempts", () => {
  it("reads a stored count", () => {
    expect(parseAttempts("3")).toBe(3);
  });
  it("treats missing or corrupt values as zero", () => {
    expect(parseAttempts(null)).toBe(0);
    expect(parseAttempts("")).toBe(0);
    expect(parseAttempts("abc")).toBe(0);
    expect(parseAttempts("-2")).toBe(0);
    expect(parseAttempts("1.5")).toBe(0);
  });
});
