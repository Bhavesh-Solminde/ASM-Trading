import { describe, expect, it } from "vitest";
import {
  CRYPTO_INTRADAY,
  FX_MAJOR_INTRADAY,
  INDEX_INTRADAY,
  INTRADAY_PROFILES,
  intradayFactor,
} from "./intraday";

describe("intradayFactor", () => {
  it("mean of factor² over a full day is 1 (variance-normalized)", () => {
    for (const [name, profile] of Object.entries(INTRADAY_PROFILES)) {
      let sum = 0;
      const SAMPLES = 24 * 60;
      for (let i = 0; i < SAMPLES; i++) {
        const t = (i / SAMPLES) * 86400;
        const f = intradayFactor(profile, t);
        sum += f * f;
      }
      const mean = sum / SAMPLES;
      expect(mean, name).toBeGreaterThan(0.95);
      expect(mean, name).toBeLessThan(1.05);
    }
  });

  it("rejects a profile that is the wrong length", () => {
    expect(() => intradayFactor([1, 2, 3], 0)).toThrow();
  });

  it("rejects a profile containing non-positive values", () => {
    const bad = [...CRYPTO_INTRADAY];
    bad[0] = 0;
    expect(() => intradayFactor(bad, 0)).toThrow();
  });

  it("FX_MAJOR peaks around the London / NY overlap (13:00–14:00 UTC)", () => {
    const peakHour = FX_MAJOR_INTRADAY.indexOf(Math.max(...FX_MAJOR_INTRADAY));
    expect(peakHour).toBeGreaterThanOrEqual(12);
    expect(peakHour).toBeLessThanOrEqual(14);
  });

  it("INDEX profile has an off-session floor (0.63) and in-session peak > 2", () => {
    const max = Math.max(...INDEX_INTRADAY);
    const min = Math.min(...INDEX_INTRADAY);
    expect(min).toBeCloseTo(0.63, 2);
    expect(max).toBeGreaterThan(2);
  });

  it("interpolates smoothly across the top of the hour", () => {
    const h12 = intradayFactor(FX_MAJOR_INTRADAY, 12 * 3600);
    const h13 = intradayFactor(FX_MAJOR_INTRADAY, 13 * 3600);
    const midway = intradayFactor(FX_MAJOR_INTRADAY, 12 * 3600 + 1800);
    // Midway value sits between the two hour samples (not a hard step).
    const lo = Math.min(h12, h13);
    const hi = Math.max(h12, h13);
    expect(midway).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(midway).toBeLessThanOrEqual(hi + 1e-9);
  });
});
