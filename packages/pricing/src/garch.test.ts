import { describe, expect, it } from "vitest";
import { initGarch, stepGarch, type GarchParams } from "./garch";
import { createRng } from "./rng";

const params: GarchParams = { omega: 0.000001, alpha: 0.08, beta: 0.9 };

describe("garch", () => {
  it("initialises sigma2 at the unconditional variance", () => {
    const state = initGarch(params);
    const expected = params.omega / (1 - params.alpha - params.beta);
    expect(state.sigma2).toBeCloseTo(expected, 12);
  });

  it("returns sigma as the square root of sigma2", () => {
    const state = initGarch(params);
    const { sigma } = stepGarch(state, params, 0);
    expect(sigma).toBeGreaterThan(0);
    expect(sigma).toBeCloseTo(Math.sqrt(state.sigma2), 12);
  });

  it("raises volatility after a large shock", () => {
    const calm = stepGarch(initGarch(params), params, 0.1);
    const shocked = stepGarch(initGarch(params), params, 5);
    expect(shocked.state.sigma2).toBeGreaterThan(calm.state.sigma2);
  });

  it("stays stationary — sigma2 does not diverge over many steps", () => {
    const rng = createRng(3);
    let state = initGarch(params);
    for (let i = 0; i < 100_000; i++) {
      state = stepGarch(state, params, rng.normal()).state;
    }
    const unconditional = params.omega / (1 - params.alpha - params.beta);
    expect(state.sigma2).toBeGreaterThan(unconditional / 50);
    expect(state.sigma2).toBeLessThan(unconditional * 50);
  });

  it("produces volatility clustering — autocorrelated squared returns", () => {
    const rng = createRng(11);
    let state = initGarch(params);
    const sq: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const z = rng.normal();
      const { state: nextState, sigma } = stepGarch(state, params, z);
      state = nextState;
      sq.push((sigma * z) ** 2);
    }
    const mean = sq.reduce((s, v) => s + v, 0) / sq.length;
    let cov = 0;
    let varr = 0;
    for (let i = 1; i < sq.length; i++) {
      cov += (sq[i]! - mean) * (sq[i - 1]! - mean);
      varr += (sq[i]! - mean) ** 2;
    }
    const lag1 = cov / varr;
    // Independent noise would give ~0. Clustering must be clearly positive.
    expect(lag1).toBeGreaterThan(0.1);
  });
});
