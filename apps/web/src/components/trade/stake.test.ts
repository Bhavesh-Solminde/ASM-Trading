import { describe, expect, it } from "vitest";
import { parseSavedExpiry, parseSavedStake, stakeStorageKey } from "./stake";

describe("parseSavedStake", () => {
  it("keeps a positive amount with up to two decimals", () => {
    expect(parseSavedStake("250")).toBe("250");
    expect(parseSavedStake("12.5")).toBe("12.5");
    expect(parseSavedStake("7.")).toBe("7.");
  });

  it("drops missing, malformed or zero amounts", () => {
    for (const raw of [null, "", "0", "0.00", "abc", "-5", "1.234", "1e3"]) {
      expect(parseSavedStake(raw)).toBeNull();
    }
  });

  it("keys stakes per currency", () => {
    expect(stakeStorageKey("INR")).not.toBe(stakeStorageKey("USD"));
  });
});

describe("parseSavedExpiry", () => {
  const NOW = 1_800_000_000_000;

  it("restores a timer duration the engine still offers", () => {
    expect(parseSavedExpiry(JSON.stringify({ durationSec: 300, mode: "timer", targetMs: null }), NOW)).toEqual({
      durationSec: 300,
      mode: "timer",
      targetMs: null,
    });
  });

  it("restores a TIME-mode target that is still in the future", () => {
    const raw = JSON.stringify({ durationSec: 60, mode: "time", targetMs: NOW + 90_000 });
    expect(parseSavedExpiry(raw, NOW)).toEqual({ durationSec: 60, mode: "time", targetMs: NOW + 90_000 });
  });

  it("falls back to timer mode when the TIME-mode target has passed", () => {
    const raw = JSON.stringify({ durationSec: 60, mode: "time", targetMs: NOW - 1 });
    expect(parseSavedExpiry(raw, NOW)).toEqual({ durationSec: 60, mode: "timer", targetMs: null });
  });

  it("rejects junk and durations that aren't offered", () => {
    expect(parseSavedExpiry(null, NOW)).toBeNull();
    expect(parseSavedExpiry("{not json", NOW)).toBeNull();
    expect(parseSavedExpiry(JSON.stringify({ durationSec: 42, mode: "timer" }), NOW)).toBeNull();
    expect(parseSavedExpiry("7", NOW)).toBeNull();
  });
});
