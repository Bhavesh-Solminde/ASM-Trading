import { describe, expect, it } from "vitest";
import { TARGETS, desiredWinProb, tradeWeight, WINDOW_SIZE } from "../src/index";
import type { AccountStats, WindowEntry } from "../src/index";

function statsWith(n: number, won: boolean): AccountStats {
  const window: WindowEntry[] = Array.from({ length: n }, () => ({
    weight: tradeWeight(10_000, 10_000),
    won,
  }));
  return {
    stage: "DEPOSITED",
    shortWindow: window.slice(-WINDOW_SIZE),
    lifetimeWonWeight: won ? n : 0,
    lifetimeTotalWeight: n,
    lossStreak: won ? 0 : n,
    winStreak: won ? n : 0,
    medianStake: 10_000,
  };
}

describe("cold start", () => {
  it("applies no correction at all with zero history", () => {
    const out = desiredWinProb(statsWith(0, true));
    expect(Math.abs(out.p - TARGETS.DEPOSITED)).toBeLessThan(0.001);
  });

  it("stays close to target through the first few trades", () => {
    for (let n = 0; n <= 3; n++) {
      const out = desiredWinProb(statsWith(n, true));
      expect(Math.abs(out.p - TARGETS.DEPOSITED)).toBeLessThan(0.12);
    }
  });

  it("never engages the ceiling on an account with no history", () => {
    expect(desiredWinProb(statsWith(0, true)).ceilingActive).toBe(false);
  });

  it("grows the correction smoothly", () => {
    const deltas: number[] = [];
    for (let n = 0; n <= 20; n++) {
      deltas.push(Math.abs(desiredWinProb(statsWith(n, true)).p - TARGETS.DEPOSITED));
    }
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]! - deltas[i - 1]!).toBeLessThan(0.25);
    }
  });
});
