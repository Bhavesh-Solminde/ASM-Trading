import { describe, expect, it } from "vitest";
import { desiredWinProb, drawOutcome, stageFor } from "./controller";
import {
  HARD_CEILING,
  MAX_CORRECTION,
  P_MAX,
  P_MIN,
  TARGETS,
} from "./constants";
import type { AccountStats, WindowEntry } from "./types";

function stats(overrides: Partial<AccountStats> = {}): AccountStats {
  return {
    stage: "DEPOSITED",
    shortWindow: [],
    lifetimeWonWeight: 0,
    lifetimeTotalWeight: 0,
    lossStreak: 0,
    winStreak: 0,
    medianStake: 100,
    ...overrides,
  };
}

function runOf(n: number, won: boolean): WindowEntry[] {
  return Array.from({ length: n }, () => ({ weight: 1, won }));
}

describe("stageFor", () => {
  it("puts a demo account in PRE_DEPOSIT regardless of deposits", () => {
    expect(stageFor(999_999, true)).toBe("PRE_DEPOSIT");
  });

  it("puts a live account with no deposits in PRE_DEPOSIT", () => {
    expect(stageFor(0, false)).toBe("PRE_DEPOSIT");
  });

  it("puts a small depositor in DEPOSITED", () => {
    expect(stageFor(10_000, false)).toBe("DEPOSITED");
  });

  it("puts a large depositor in HIGH_VALUE", () => {
    expect(stageFor(50_000, false)).toBe("HIGH_VALUE");
    expect(stageFor(500_000, false)).toBe("HIGH_VALUE");
  });
});

describe("desiredWinProb", () => {
  it("returns the stage target exactly with no history", () => {
    expect(desiredWinProb(stats({ stage: "DEPOSITED" })).p).toBeCloseTo(0.45, 6);
    expect(desiredWinProb(stats({ stage: "HIGH_VALUE" })).p).toBeCloseTo(0.27, 6);
    expect(desiredWinProb(stats({ stage: "PRE_DEPOSIT" })).p).toBeCloseTo(0.65, 6);
  });

  it("lowers p when an account is winning above target", () => {
    const out = desiredWinProb(
      stats({ shortWindow: runOf(60, true), lifetimeWonWeight: 60, lifetimeTotalWeight: 60 }),
    );
    expect(out.p).toBeLessThan(TARGETS.DEPOSITED);
  });

  it("raises p when an account is losing below target", () => {
    const out = desiredWinProb(
      stats({ shortWindow: runOf(60, false), lifetimeWonWeight: 0, lifetimeTotalWeight: 60 }),
    );
    expect(out.p).toBeGreaterThan(TARGETS.DEPOSITED);
  });

  it("never corrects further than MAX_CORRECTION from target in the normal path", () => {
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        shortWindow: runOf(200, false),
        lifetimeWonWeight: 0,
        lifetimeTotalWeight: 200,
        lossStreak: 0,
      }),
    );
    expect(out.p).toBeLessThanOrEqual(TARGETS.HIGH_VALUE + MAX_CORRECTION + 1e-9);
  });

  it("engages the ceiling when the posterior exceeds it", () => {
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: runOf(80, true),
        lifetimeWonWeight: 80,
        lifetimeTotalWeight: 80,
      }),
    );
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(0.2);
  });

  it("engages the ceiling from lifetime history even when the recent window is clean", () => {
    const out = desiredWinProb(
      stats({
        stage: "DEPOSITED",
        shortWindow: runOf(20, false),
        lifetimeWonWeight: 900,
        lifetimeTotalWeight: 1000,
      }),
    );
    expect(out.ceilingActive).toBe(true);
  });

  it("forces a likely win after the maximum loss streak", () => {
    const out = desiredWinProb(
      stats({ stage: "HIGH_VALUE", lossStreak: 8, shortWindow: runOf(40, false) }),
    );
    expect(out.p).toBeGreaterThanOrEqual(0.99);
  });

  it("forces a likely loss after the maximum win streak", () => {
    const out = desiredWinProb(stats({ stage: "PRE_DEPOSIT", winStreak: 15 }));
    expect(out.p).toBeLessThanOrEqual(0.35);
  });

  it("prioritises the ceiling over the loss-streak guard", () => {
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: runOf(80, true),
        lifetimeWonWeight: 80,
        lifetimeTotalWeight: 80,
        lossStreak: 8,
      }),
    );
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(0.2);
  });

  it("applies the ceiling correction even with low window weight but high lifetime breach", () => {
    const out = desiredWinProb(
      stats({
        stage: "DEPOSITED",
        shortWindow: runOf(3, false),
        lifetimeWonWeight: 900,
        lifetimeTotalWeight: 1000,
      }),
    );
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeLessThan(TARGETS.DEPOSITED);
  });

  it("always clamps p into [P_MIN, P_MAX]", () => {
    const cases: AccountStats[] = [
      stats({ shortWindow: runOf(500, true), lifetimeWonWeight: 500, lifetimeTotalWeight: 500 }),
      stats({ shortWindow: runOf(500, false), lifetimeWonWeight: 0, lifetimeTotalWeight: 500 }),
      stats({ lossStreak: 50 }),
      stats({ winStreak: 50 }),
    ];
    for (const c of cases) {
      const { p } = desiredWinProb(c);
      expect(p).toBeGreaterThanOrEqual(P_MIN);
      expect(p).toBeLessThanOrEqual(P_MAX);
    }
  });

  it("reports urgency that rises as p moves away from a coin flip", () => {
    const nearFlip = desiredWinProb(stats({ stage: "DEPOSITED" }));
    const extreme = desiredWinProb(
      stats({ shortWindow: runOf(200, true), lifetimeWonWeight: 200, lifetimeTotalWeight: 200 }),
    );
    expect(extreme.urgency).toBeGreaterThan(nearFlip.urgency);
  });

  it("exposes diagnostics for the shadow ledger", () => {
    const out = desiredWinProb(stats({ stage: "HIGH_VALUE" }));
    expect(out.target).toBeCloseTo(0.27, 6);
    expect(out.posteriorShort).toBeCloseTo(0.27, 6);
    expect(out.posteriorLife).toBeCloseTo(0.27, 6);
  });

  it("holds a pre-deposit account at the ceiling rather than overshooting", () => {
    const w: WindowEntry[] = Array.from({ length: 100 }, (_, i) => ({
      weight: 1,
      won: i % 100 < 65,
    }));
    const out = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: w,
        lifetimeWonWeight: 65,
        lifetimeTotalWeight: 100,
      }),
    );
    expect(out.p).toBeGreaterThan(0.4);
    expect(out.p).toBeLessThan(HARD_CEILING + 0.05);
  });
});

describe("drawOutcome", () => {
  it("returns true when the draw is below p", () => {
    expect(drawOutcome(0.9, { next: () => 0.1 })).toBe(true);
  });

  it("returns false when the draw is above p", () => {
    expect(drawOutcome(0.1, { next: () => 0.9 })).toBe(false);
  });

  it("approximates p over many draws", () => {
    let seed = 1;
    const rng = {
      next: () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      },
    };
    let wins = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (drawOutcome(0.27, rng)) wins++;
    expect(Math.abs(wins / n - 0.27)).toBeLessThan(0.01);
  });
});
