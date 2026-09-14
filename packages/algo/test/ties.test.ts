import { describe, expect, it } from "vitest";
import { simulate } from "./harness";

describe("tie handling", () => {
  it("excludes refunds from the realised rate", () => {
    const r = simulate({
      stage: "DEPOSITED",
      trades: 3_000,
      seed: 2026,
      tieEvery: 5,
    });
    const refunds = r.outcomes.filter((o) => o === "REFUNDED").length;

    expect(refunds).toBeGreaterThan(500);
    // Rate is computed over settled trades only.
    expect(Math.abs(r.realisedRate - 0.45)).toBeLessThan(0.04);
  });

  it("does not let refunds inflate a loss streak", () => {
    const r = simulate({
      stage: "HIGH_VALUE",
      trades: 20_000,
      seed: 9090,
      tieEvery: 3,
    });
    // If refunds counted as losses, streaks would blow past the guard.
    expect(r.longestLossRun).toBeLessThanOrEqual(13);
  });

  it("leaves the window and totals untouched for a refunded trade", () => {
    const withTies = simulate({
      stage: "DEPOSITED",
      trades: 100,
      seed: 4,
      tieEvery: 2,
    });
    const settled = withTies.outcomes.filter((o) => o !== "REFUNDED").length;
    expect(withTies.finalStats.lifetimeTotalWeight).toBeCloseTo(settled, 6);
  });
});
