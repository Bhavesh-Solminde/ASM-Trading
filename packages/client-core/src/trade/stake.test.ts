import { describe, expect, it } from "vitest";
import {
  MAX_STAKE_MAJOR,
  nextStakeInput,
  parseSavedExpiry,
  parseSavedPercent,
  parseSavedStake,
  parseSavedUnit,
  percentValue,
  stakeFromPercent,
  stakeStorageKey,
} from "./stake";

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

describe("percent stakes", () => {
  it("takes a share of the balance, rounded down to whole units", () => {
    // ₹9,853.47 balance, 10% -> ₹985 (not ₹985.34)
    expect(stakeFromPercent(10, 985_347, 100_00)).toBe(985_00);
    expect(stakeFromPercent(100, 985_347, 100_00)).toBe(9853_00);
  });

  it("never goes below the ₹100 / $1 minimum, even at a tiny percentage or balance", () => {
    expect(stakeFromPercent(1, 5000_00, 100_00)).toBe(100_00); // 1% of ₹5,000 = ₹50 -> ₹100
    expect(stakeFromPercent(50, 0, 100_00)).toBe(100_00);
    expect(stakeFromPercent(1, 50_00, 1_00)).toBe(1_00); // $0.50 -> $1
  });

  it("caps the percentage at 100 and has no answer before the balance loads", () => {
    expect(stakeFromPercent(250, 1000_00, 100_00)).toBe(1000_00);
    expect(stakeFromPercent(10, null, 100_00)).toBeNull();
    expect(stakeFromPercent(0, 1000_00, 100_00)).toBeNull();
  });

  it("reads the typed percentage and the saved settings defensively", () => {
    expect(percentValue("25")).toBe(25);
    expect(percentValue("150")).toBe(100);
    expect(percentValue("")).toBe(0);
    expect(percentValue("abc")).toBe(0);
    expect(parseSavedPercent("25")).toBe("25");
    for (const raw of [null, "", "0", "101", "2.5", "-3", "x"]) expect(parseSavedPercent(raw)).toBeNull();
    expect(parseSavedUnit("percent")).toBe("percent");
    expect(parseSavedUnit("amount")).toBe("amount");
    expect(parseSavedUnit("pct")).toBeNull();
  });
});

describe("nextStakeInput", () => {
  it("keeps digits and the decimal point only", () => {
    expect(nextStakeInput("₹1,250", "100")).toBe("1250");
  });
  it("accepts up to the max and rejects anything above it", () => {
    expect(MAX_STAKE_MAJOR).toBe(1_000_000);
    expect(nextStakeInput("1000000", "100000")).toBe("1000000");
    expect(nextStakeInput("10000000", "1000000")).toBe("1000000");
    expect(nextStakeInput("1000000.5", "1000000")).toBe("1000000");
  });
});
