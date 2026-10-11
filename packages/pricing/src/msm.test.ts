import { describe, expect, it } from "vitest";
import {
  initMsm,
  msmDurations,
  msmMultiplier,
  stepMsm,
  type MsmParams,
} from "./msm";
import { createRng } from "./rng";

const params: MsmParams = {
  sigma: 1e-3,
  components: 8,
  m0: 1.5,
  fastestSec: 1,
  slowestSec: 3 * 86400,
};

describe("MSM", () => {
  it("validates params", () => {
    expect(() => initMsm({ ...params, sigma: 0 }, Math.random)).toThrow();
    expect(() => initMsm({ ...params, m0: 2 }, Math.random)).toThrow();
    expect(() =>
      initMsm({ ...params, fastestSec: 10, slowestSec: 1 }, Math.random),
    ).toThrow();
  });

  it("init draws one layer per component", () => {
    const rng = createRng(1);
    const state = initMsm(params, rng.next);
    expect(state.layers).toHaveLength(8);
    for (const v of state.layers) {
      // Each layer is either m0 or 2 - m0.
      expect(v === params.m0 || v === 2 - params.m0).toBe(true);
    }
  });

  it("durations are geometrically spaced from slowest to fastest", () => {
    const d = msmDurations(params);
    expect(d).toHaveLength(8);
    expect(d[0]).toBeCloseTo(params.slowestSec, 6);
    expect(d[d.length - 1]).toBeCloseTo(params.fastestSec, 6);
    // Monotone decreasing.
    for (let i = 1; i < d.length; i++) {
      expect(d[i]!).toBeLessThan(d[i - 1]!);
    }
  });

  it("multiplier squared averages ~1 over many independent states", () => {
    const rng = createRng(42);
    let sum = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const s = initMsm(params, rng.next);
      const m = msmMultiplier(s);
      sum += m * m;
    }
    const mean = sum / N;
    // E[m²] = E[prod(layers)] = 1 exactly in expectation (layers i.i.d. mean 1).
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
  });

  it("stepMsm leaves fast layers more volatile than slow ones", () => {
    const rng = createRng(7);
    let state = initMsm(params, rng.next);
    // Count how often each layer flips over many ticks of 5s each.
    const flips = new Array<number>(params.components).fill(0);
    const prev = [...state.layers];
    for (let i = 0; i < 20_000; i++) {
      const next = stepMsm(state, params, 5, rng.next);
      for (let k = 0; k < params.components; k++) {
        if (next.layers[k] !== prev[k]) flips[k]! += 1;
        prev[k] = next.layers[k]!;
      }
      state = next;
    }
    // Fastest layer (last index) flips far more often than slowest (0).
    expect(flips[params.components - 1]!).toBeGreaterThan(flips[0]! * 100);
  });

  it("produces fatter tails than independent gaussian in log returns", () => {
    // Smoke check: with m0 > 1 the multiplier varies, so the simulated
    // returns have more kurtosis than a plain gaussian. Not a strict
    // equality — a sanity bound.
    const rng = createRng(99);
    let state = initMsm(params, rng.next);
    const returns: number[] = [];
    for (let i = 0; i < 50_000; i++) {
      state = stepMsm(state, params, 5, rng.next);
      const z = rng.normal();
      returns.push(params.sigma * msmMultiplier(state) * Math.sqrt(5) * z);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const m2 = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const m4 = returns.reduce((a, b) => a + (b - mean) ** 4, 0) / returns.length;
    const kurt = m4 / (m2 * m2) - 3;
    // Gaussian excess kurtosis is 0; MSM should push it clearly positive.
    expect(kurt).toBeGreaterThan(0.5);
  });
});
