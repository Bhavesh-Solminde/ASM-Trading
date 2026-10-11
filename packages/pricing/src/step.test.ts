import { describe, expect, it } from "vitest";
import { initPriceState, stepPrice, type PriceParams } from "./step";
import { createRng } from "./rng";

const params: PriceParams = {
  msm: {
    sigma: 1.0e-3,
    components: 8,
    m0: 1.5,
    fastestSec: 1,
    slowestSec: 3 * 86400,
  },
  driftPerSec: 0,
  anchorAlpha: 0,
  maxTickMove: 0.01,
};

function run(
  n: number,
  seed: number,
  overrides: Partial<{
    driftBias: number;
    magnet: number;
    anchorTarget: number;
    anchorAlpha: number;
    volScale: number;
  }> = {},
) {
  const p: PriceParams = {
    ...params,
    anchorAlpha: overrides.anchorAlpha ?? params.anchorAlpha,
  };
  const rng = createRng(seed);
  let state = initPriceState(1.175, p);
  for (let i = 0; i < n; i++) {
    state = stepPrice({
      state,
      params: p,
      dtSec: 0.1,
      z: rng.normal(),
      volScale: overrides.volScale ?? 1,
      driftBias: overrides.driftBias ?? 0,
      magnet: overrides.magnet ?? 0,
      anchorTarget: overrides.anchorTarget ?? null,
    }).state;
  }
  return state.price;
}

describe("stepPrice", () => {
  it("starts at the base price", () => {
    expect(initPriceState(1.175, params).price).toBe(1.175);
  });

  it("keeps the price strictly positive over a long run", () => {
    const rng = createRng(5);
    let state = initPriceState(1.175, params);
    for (let i = 0; i < 50_000; i++) {
      state = stepPrice({
        state,
        params,
        dtSec: 0.1,
        z: rng.normal(),
        volScale: 1,
        driftBias: 0,
        magnet: 0,
        anchorTarget: null,
      }).state;
      expect(state.price).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(run(2000, 21)).toBe(run(2000, 21));
  });

  it("drifts upward under a positive bias and downward under a negative one", () => {
    const up = run(3000, 33, { driftBias: 0.0002 });
    const down = run(3000, 33, { driftBias: -0.0002 });
    expect(up).toBeGreaterThan(down);
  });

  it("moves toward the anchor target when anchoring is enabled", () => {
    const anchorTarget = 1.25;
    const anchored = run(2000, 44, { anchorTarget, anchorAlpha: 0.05 });
    const unanchored = run(2000, 44, { anchorTarget, anchorAlpha: 0 });
    expect(Math.abs(anchored - anchorTarget)).toBeLessThan(
      Math.abs(unanchored - anchorTarget),
    );
  });

  it("clamps a single tick to maxTickMove", () => {
    const tight: PriceParams = { ...params, maxTickMove: 0.0001 };
    const state = initPriceState(1.175, tight);
    const out = stepPrice({
      state,
      params: tight,
      dtSec: 0.1,
      z: 0,
      volScale: 1,
      driftBias: 0,
      magnet: 10, // absurd magnet — must be clamped
      anchorTarget: null,
    });
    expect(Math.abs(out.price - 1.175)).toBeLessThanOrEqual(0.0001 + 1e-12);
  });

  it("reports the sigma used for the tick (scaled by volScale)", () => {
    const out = stepPrice({
      state: initPriceState(1.175, params),
      params,
      dtSec: 0.1,
      z: 0.5,
      volScale: 2,
      driftBias: 0,
      magnet: 0,
      anchorTarget: null,
    });
    expect(out.sigma).toBeCloseTo(params.msm.sigma * 2, 12);
  });

  it("volScale scales the realised move magnitude", () => {
    const quiet = run(2000, 101, { volScale: 0.5 });
    const loud = run(2000, 101, { volScale: 2 });
    const quietDrift = Math.abs(quiet - 1.175);
    const loudDrift = Math.abs(loud - 1.175);
    // Louder path drifts further on average (not a strict bound; sanity).
    expect(loudDrift).toBeGreaterThan(quietDrift * 0.5);
  });
});
