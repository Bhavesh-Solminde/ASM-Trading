import { describe, expect, it } from "vitest";
import { posterior, posteriorFromTotals, tradeWeight } from "./estimator";
import { PRIOR_SHORT, WEIGHT_CAP, WEIGHT_FLOOR, WEIGHT_REFERENCE_FLOOR } from "./constants";
import type { WindowEntry } from "./types";

function win(weight: number): WindowEntry {
  return { weight, won: true };
}
function loss(weight: number): WindowEntry {
  return { weight, won: false };
}

describe("tradeWeight", () => {
  it("gives a typical trade (at median) a weight of 1", () => {
    expect(tradeWeight(10_000, 10_000)).toBeCloseTo(1, 10);
  });

  it("floors a trivially small trade", () => {
    expect(tradeWeight(1, 10_000)).toBe(WEIGHT_FLOOR);
  });

  it("caps an outsized trade", () => {
    expect(tradeWeight(1_000_000, 100)).toBe(WEIGHT_CAP);
  });

  it("treats a zero median stake as WEIGHT_REFERENCE_FLOOR rather than dividing by zero", () => {
    expect(Number.isFinite(tradeWeight(100, 0))).toBe(true);
    expect(tradeWeight(WEIGHT_REFERENCE_FLOOR, 0)).toBeCloseTo(1, 10);
  });

  it("floors when median is tiny (farming the median attack)", () => {
    // Attacker sets median to 1; WEIGHT_REFERENCE_FLOOR=1000 prevents the
    // reference from collapsing, so a normal trade still gets weight ~10_000/1000=10 -> capped
    const w = tradeWeight(10_000, 1);
    expect(w).toBeLessThanOrEqual(WEIGHT_CAP);
  });

  it("makes a hundred micro-trades worth far less than a hundred normal ones", () => {
    const micro = 100 * tradeWeight(1, 10_000);
    const normal = 100 * tradeWeight(10_000, 10_000);
    expect(micro).toBeLessThan(normal / 4);
  });
});

describe("posterior", () => {
  it("returns the target exactly for an empty window", () => {
    expect(posterior([], 0.45, PRIOR_SHORT)).toBeCloseTo(0.45, 12);
    expect(posterior([], 0.27, PRIOR_SHORT)).toBeCloseTo(0.27, 12);
  });

  it("moves above the target after wins", () => {
    const w = Array.from({ length: 30 }, () => win(1));
    expect(posterior(w, 0.45, PRIOR_SHORT)).toBeGreaterThan(0.45);
  });

  it("moves below the target after losses", () => {
    const w = Array.from({ length: 30 }, () => loss(1));
    expect(posterior(w, 0.45, PRIOR_SHORT)).toBeLessThan(0.45);
  });

  it("stays inside [0, 1] under extreme input", () => {
    const allWins = Array.from({ length: 500 }, () => win(WEIGHT_CAP));
    const allLosses = Array.from({ length: 500 }, () => loss(WEIGHT_CAP));
    expect(posterior(allWins, 0.45, PRIOR_SHORT)).toBeLessThanOrEqual(1);
    expect(posterior(allLosses, 0.45, PRIOR_SHORT)).toBeGreaterThanOrEqual(0);
  });

  it("converges on the empirical rate as evidence accumulates", () => {
    const w = Array.from({ length: 400 }, (_, i) => (i % 10 < 7 ? win(1) : loss(1)));
    expect(posterior(w, 0.27, PRIOR_SHORT)).toBeGreaterThan(0.65);
  });

  it("weights a heavy trade more than a light one", () => {
    const heavyWin = posterior([win(5), loss(0.2)], 0.5, PRIOR_SHORT);
    const lightWin = posterior([win(0.2), loss(5)], 0.5, PRIOR_SHORT);
    expect(heavyWin).toBeGreaterThan(lightWin);
  });
});

describe("posteriorFromTotals", () => {
  it("matches posterior for equivalent input", () => {
    const w = [win(1), win(1), loss(1)];
    const fromWindow = posterior(w, 0.45, PRIOR_SHORT);
    const fromTotals = posteriorFromTotals(2, 3, 0.45, PRIOR_SHORT);
    expect(fromTotals).toBeCloseTo(fromWindow, 12);
  });

  it("returns the target for zero total weight", () => {
    expect(posteriorFromTotals(0, 0, 0.27, PRIOR_SHORT)).toBeCloseTo(0.27, 12);
  });
});
