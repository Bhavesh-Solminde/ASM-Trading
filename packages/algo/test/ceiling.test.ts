import { describe, expect, it } from "vitest";
import { HARD_CEILING, desiredWinProb } from "../src/index";
import { simulate } from "./harness";

describe("hard ceiling", () => {
  it("drives p down hard once forced wins push the posterior over the ceiling", () => {
    const forced = simulate({ stage: "PRE_DEPOSIT", trades: 60, seed: 7, forceWin: true });
    const out = desiredWinProb(forced.finalStats);
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(0.2);
  });

  it("recovers a breached account back under the ceiling", () => {
    const breached = simulate({ stage: "PRE_DEPOSIT", trades: 60, seed: 8, forceWin: true });
    expect(desiredWinProb(breached.finalStats).ceilingActive).toBe(true);

    const recovered = simulate({
      stage: "PRE_DEPOSIT", trades: 400, seed: 9, initial: breached.finalStats,
    });
    expect(desiredWinProb(recovered.finalStats).ceilingActive).toBe(false);
  });

  it("does not sustain a breach for many trades after it starts", () => {
    const breached = simulate({ stage: "PRE_DEPOSIT", trades: 60, seed: 12, forceWin: true });
    const after = simulate({
      stage: "PRE_DEPOSIT", trades: 120, seed: 13, initial: breached.finalStats,
    });
    const stillBreached = after.ceilingActiveTrajectory.filter(Boolean).length;
    expect(stillBreached).toBeLessThan(60);
  });

  it("never lets any stage exceed the ceiling in the long run", () => {
    for (const stage of ["PRE_DEPOSIT", "DEPOSITED", "HIGH_VALUE"] as const) {
      const r = simulate({ stage, trades: 20_000, seed: 404 });
      expect(r.realisedRate).toBeLessThanOrEqual(HARD_CEILING + 0.02);
    }
  });
});
