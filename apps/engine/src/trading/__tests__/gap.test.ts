import { describe, it, expect } from "vitest";
import { GapTracker, cryptoMaintenancePhase } from "../gap";

describe("GapTracker", () => {
  it("accumulates magnet pull into gap", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });

    tracker.push("BTCUSD", 0.0001, 3);
    expect(tracker.gap("BTCUSD")).toBeCloseTo(0.0001, 5);
    expect(tracker.shownPrice("BTCUSD", 95000)).toBeCloseTo(95000 * 1.0001, 0);
  });

  it("decays gap exponentially (half-life ~2.4h)", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });

    tracker.push("BTCUSD", 0.01, 3);
    const initial = tracker.gap("BTCUSD");

    for (let i = 0; i < 2880; i++) {
      tracker.push("BTCUSD", 0, 3);
    }

    expect(tracker.gap("BTCUSD")).toBeCloseTo(initial / 2, 4);
  });

  it("caps gap at maxGapMultiple × sigma1h", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });

    tracker.push("BTCUSD", 1.0, 3);

    const gap = tracker.gap("BTCUSD");
    expect(gap).toBeLessThanOrEqual(0.015);
    expect(gap).toBeCloseTo(0.015, 5);
  });

  it("caps negative gap", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });

    tracker.push("BTCUSD", -1.0, 3);
    expect(tracker.gap("BTCUSD")).toBeGreaterThanOrEqual(-0.015);
  });

  it("resets gap to zero", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });
    tracker.push("BTCUSD", 0.005, 3);
    expect(tracker.gap("BTCUSD")).not.toBe(0);

    tracker.reset("BTCUSD");
    expect(tracker.gap("BTCUSD")).toBe(0);
  });

  it("returns 0 gap for unregistered symbol", () => {
    const tracker = new GapTracker();
    expect(tracker.gap("UNKNOWN")).toBe(0);
  });

  it("shownPrice equals realPrice when gap is 0", () => {
    const tracker = new GapTracker();
    tracker.registerAsset("BTCUSD", { sigma1h: 0.005, maxGapMultiple: 3 });
    expect(tracker.shownPrice("BTCUSD", 95000)).toBe(95000);
  });
});

describe("cryptoMaintenancePhase", () => {
  it("returns FROZEN at 4:30 AM IST", () => {
    // 4:30 AM IST = 23:00 UTC previous day
    const d = new Date("2026-10-22T23:00:00Z");
    expect(cryptoMaintenancePhase(d)).toBe("FROZEN");
  });

  it("returns CONVERGING at 5:30 AM IST", () => {
    // 5:30 AM IST = 00:00 UTC
    const d = new Date("2026-10-23T00:00:00Z");
    expect(cryptoMaintenancePhase(d)).toBe("CONVERGING");
  });

  it("returns OPEN at 7:00 AM IST", () => {
    // 7:00 AM IST = 01:30 UTC
    const d = new Date("2026-10-23T01:30:00Z");
    expect(cryptoMaintenancePhase(d)).toBe("OPEN");
  });

  it("returns OPEN at 3:00 PM IST", () => {
    const d = new Date("2026-10-23T09:30:00Z");
    expect(cryptoMaintenancePhase(d)).toBe("OPEN");
  });
});
