import { describe, expect, it } from "vitest";
import { desiredWinProb, posterior, tradeWeight, PRIOR_SHORT, WEIGHT_CAP } from "../src/index";
import type { WindowEntry } from "../src/index";

describe("micro-stake farming", () => {
  const MEDIAN = 10_000;

  it("caps the influence of a hundred trivial losses", () => {
    const micro: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(1, MEDIAN),
      won: false,
    }));
    const normal: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(MEDIAN, MEDIAN),
      won: false,
    }));

    const microPosterior = posterior(micro, 0.45, PRIOR_SHORT);
    const normalPosterior = posterior(normal, 0.45, PRIOR_SHORT);

    // Both push the posterior down, but the farmed one must push far less.
    expect(microPosterior).toBeGreaterThan(normalPosterior + 0.15);
  });

  it("does not hand a farmer a favourable p", () => {
    const farmed: WindowEntry[] = Array.from({ length: 100 }, () => ({
      weight: tradeWeight(1, MEDIAN),
      won: false,
    }));
    const out = desiredWinProb({
      stage: "HIGH_VALUE",
      shortWindow: farmed,
      lifetimeWonWeight: 0,
      lifetimeTotalWeight: 100 * tradeWeight(1, MEDIAN),
      lossStreak: 0,
      winStreak: 0,
      medianStake: MEDIAN,
    });
    expect(out.p).toBeLessThan(0.5);
  });

  it("caps the payoff trade's own weight", () => {
    expect(tradeWeight(1_000_000, MEDIAN)).toBeLessThanOrEqual(WEIGHT_CAP);
  });

  it("makes the exploit ratio unfavourable", () => {
    const farmWeight = 100 * tradeWeight(1, MEDIAN);
    const payoffWeight = tradeWeight(1_000_000, MEDIAN);
    expect(farmWeight).toBeGreaterThan(payoffWeight * 1.5);
  });
});
