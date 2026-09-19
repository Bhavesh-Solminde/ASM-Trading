import { describe, expect, it } from "vitest";
import { TARGETS } from "../src/index";
import { simulate } from "./harness";

describe("convergence", () => {
  it("hits the PRE_DEPOSIT target within 2 points", () => {
    const r = simulate({ stage: "PRE_DEPOSIT", trades: 10_000, seed: 101 });
    expect(Math.abs(r.realisedRate - TARGETS.PRE_DEPOSIT)).toBeLessThan(0.02);
  });

  it("hits the DEPOSITED target within 2 points", () => {
    const r = simulate({ stage: "DEPOSITED", trades: 10_000, seed: 202 });
    expect(Math.abs(r.realisedRate - TARGETS.DEPOSITED)).toBeLessThan(0.02);
  });

  it("hits the HIGH_VALUE target within 2 points", () => {
    const r = simulate({ stage: "HIGH_VALUE", trades: 10_000, seed: 303 });
    expect(Math.abs(r.realisedRate - TARGETS.HIGH_VALUE)).toBeLessThan(0.02);
  });

  it("converges across independent seeds", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = simulate({ stage: "HIGH_VALUE", trades: 5_000, seed });
      expect(Math.abs(r.realisedRate - TARGETS.HIGH_VALUE)).toBeLessThan(0.03);
    }
  });
});
