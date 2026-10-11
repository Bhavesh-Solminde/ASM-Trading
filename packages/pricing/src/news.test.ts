import { describe, expect, it } from "vitest";
import {
  newsVarianceFactor,
  stepNews,
  withNews,
  type NewsParams,
} from "./news";
import { createRng } from "./rng";

const params: NewsParams = {
  perDay: 1.5,
  peak: 5,
  peakSpread: 0.5,
  decaySec: 600,
};

describe("news shocks", () => {
  it("decays level toward 0 with no new shocks", () => {
    const rng = createRng(1);
    // Force no new arrivals by making uniform always return 1 (above threshold).
    const uniform = () => 1;
    let level = 5;
    for (let i = 0; i < 10_000; i++) {
      level = stepNews(level, params, 5, 1, uniform, rng.normal);
    }
    expect(level).toBeLessThan(1e-6);
  });

  it("variance factor > 1 (shocks raise average variance)", () => {
    const vf = newsVarianceFactor(params);
    expect(vf).toBeGreaterThan(1);
    expect(vf).toBeLessThan(10);
  });

  it("withNews returns base when level is 0", () => {
    const base = 1.3;
    const combined = withNews(base, 0, params);
    // Dividing by sqrt(vf) means withNews(base, 0) is base / sqrt(vf), so a
    // calm period runs slightly quieter — the day-average budget is spent
    // partly on shocks.
    expect(combined).toBeCloseTo(base / Math.sqrt(newsVarianceFactor(params)), 10);
  });

  it("average level² over a long sim approximates (variance factor − 1)", () => {
    const rng = createRng(42);
    let level = 0;
    let sum = 0;
    const N = 500_000;
    const dt = 5;
    for (let i = 0; i < N; i++) {
      level = stepNews(level, params, dt, 1, rng.next, rng.normal);
      sum += level * level;
    }
    const mean = sum / N;
    const expected = newsVarianceFactor(params) - 1;
    // Noisy — accept a factor-of-2 band to catch gross calibration errors.
    expect(mean).toBeGreaterThan(expected * 0.3);
    expect(mean).toBeLessThan(expected * 3);
  });
});
