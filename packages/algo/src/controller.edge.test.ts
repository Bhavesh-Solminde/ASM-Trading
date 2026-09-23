import { describe, expect, it } from "vitest";
import { desiredWinProb } from "./controller";
import {
  CEILING_CLAMP,
  HARD_CEILING,
  LOSS_GUARD_BASE,
  MAX_LOSS_STREAK,
  MAX_WIN_STREAK,
  P_MAX,
  P_MIN,
} from "./constants";
import type { AccountStats, WindowEntry } from "./types";

/**
 * Edge-case coverage for the controller. Split out from the base controller
 * test file so each concern reads on its own:
 *
 * - A2: urgency floor. Every wish carries at least URGENCY_FLOOR of voice.
 * - A5: loss guard is deliberately off when the ceiling is active. Locked
 *       in here so the intent is executable, not just a comment.
 * - A7: ceiling clamp effectively pins to CEILING_CLAMP.
 */

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

describe("A2 — urgency floor", () => {
  it("an on-target user carries a non-zero urgency (not literally zero)", () => {
    // stage DEPOSITED, target 0.45. With no history the posterior is exactly
    // the target so p sits at the target and error term is 0 — the classic
    // "invisible on-target user" case that A2 fixes.
    const out = desiredWinProb(stats({ stage: "DEPOSITED" }));
    expect(out.p).toBeCloseTo(0.45, 6);
    expect(out.urgency).toBeGreaterThan(0);
  });

  it("preserves the natural urgency when it's already above the floor", () => {
    // A hot-streak user way off target — the urgency should reflect the real
    // distance, not the small floor value.
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        shortWindow: runOf(30, true),
        lifetimeWonWeight: 100,
        lifetimeTotalWeight: 110,
      }),
    );
    // Ceiling-active adds +1 to urgency, so the floor is nowhere near
    // relevant here.
    expect(out.urgency).toBeGreaterThan(0.5);
  });
});

describe("A5 — loss guard is off when the ceiling is active", () => {
  it("does NOT floor p when ceiling is active AND the user is on a loss streak", () => {
    // Recipe for a ceiling-active user on a loss streak: high lifetime win
    // rate (drives ceilingPosterior above HARD_CEILING), plus a hot streak
    // of losses on the count. The controller should still pull p toward
    // CEILING_CLAMP rather than bailing the user out via the loss guard.
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        lifetimeWonWeight: 100,
        lifetimeTotalWeight: 110, // ~91% lifetime — well above HARD_CEILING
        shortWindow: runOf(30, true), // short posterior also high → confidence pinned
        lossStreak: MAX_LOSS_STREAK + 3, // would normally trigger the guard
      }),
    );
    expect(out.ceilingActive).toBe(true);
    // Loss guard would push p >= LOSS_GUARD_BASE (0.98). Ceiling should
    // dominate and pull it far below that.
    expect(out.p).toBeLessThan(LOSS_GUARD_BASE);
    // In fact it should be pinned right around CEILING_CLAMP.
    expect(out.p).toBeLessThanOrEqual(CEILING_CLAMP + 0.02);
  });

  it("still applies the loss guard when the ceiling is NOT active", () => {
    // No lifetime win history → ceiling stays inert. Loss streak alone
    // should trigger the floor.
    const out = desiredWinProb(
      stats({
        stage: "DEPOSITED",
        lossStreak: MAX_LOSS_STREAK + 1,
        shortWindow: runOf(30, false), // confidence up, posterior low → correction wants p high anyway
      }),
    );
    expect(out.ceilingActive).toBe(false);
    expect(out.p).toBeGreaterThanOrEqual(LOSS_GUARD_BASE);
  });
});

describe("A7 — ceiling clamp behaviour", () => {
  it("pulls p at or below CEILING_CLAMP when the ceiling engages with full confidence", () => {
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        lifetimeWonWeight: 100,
        lifetimeTotalWeight: 110,
        shortWindow: runOf(30, true), // saturate confidence
      }),
    );
    expect(out.ceilingActive).toBe(true);
    // At full confidence the short-window correction can already pull p
    // below CEILING_CLAMP (an all-wins short window drives the correction
    // hard downward before the ceiling blend runs). The ceiling only ever
    // pulls p DOWN through the clamp, never up — so the guarantee here is
    // "p is at most CEILING_CLAMP", not "exactly CEILING_CLAMP".
    expect(out.p).toBeLessThanOrEqual(CEILING_CLAMP + 1e-9);
  });

  it("softens the ceiling pull for a low-confidence account (bootstrap protection)", () => {
    // A ceiling-active account with a mostly-empty short window: lifetime
    // rate is high enough to trip the ceiling, but only a few recent
    // trades so confidence is small. The blend `p + c*(0.03 - p)` at
    // c=0.1 should leave p noticeably above CEILING_CLAMP — the point is
    // to not crush a fresh account to 0.03 from its third trade.
    const out = desiredWinProb(
      stats({
        stage: "HIGH_VALUE",
        lifetimeWonWeight: 100,
        lifetimeTotalWeight: 100,
        shortWindow: runOf(3, true), // windowWeight 3 → confidence 3/30 = 0.1
      }),
    );
    expect(out.ceilingActive).toBe(true);
    expect(out.p).toBeGreaterThan(CEILING_CLAMP + 0.05);
  });
});

describe("guard boundaries", () => {
  it("win-streak guard caps p at or below the win-guard ceiling", () => {
    const out = desiredWinProb(
      stats({
        stage: "DEPOSITED",
        winStreak: MAX_WIN_STREAK + 2,
        shortWindow: runOf(30, true),
      }),
    );
    expect(out.p).toBeLessThanOrEqual(0.5);
  });

  it("clamps to P_MIN / P_MAX at the extremes", () => {
    const veryHigh = desiredWinProb(
      stats({
        stage: "PRE_DEPOSIT",
        shortWindow: runOf(200, false), // maximum push upward
      }),
    );
    expect(veryHigh.p).toBeLessThanOrEqual(P_MAX);
    expect(veryHigh.p).toBeGreaterThanOrEqual(P_MIN);
  });

  it("HARD_CEILING sits exactly at the PRE_DEPOSIT target — a user who exactly hits target is not ceiling-active", () => {
    // Regression guard: HARD_CEILING === TARGETS.PRE_DEPOSIT === 0.65. A
    // fresh account whose posterior equals target must NOT engage the
    // ceiling; the check is strict inequality for that reason.
    const out = desiredWinProb(stats({ stage: "PRE_DEPOSIT" }));
    expect(HARD_CEILING).toBe(0.65);
    expect(out.ceilingActive).toBe(false);
  });
});
