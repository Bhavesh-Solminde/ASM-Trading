import {
  CEILING_CLAMP,
  CONFIDENCE_THRESHOLD,
  DEPOSIT_THRESHOLD_MINOR,
  ERROR_SCALE,
  HARD_CEILING,
  LOSS_GUARD_BASE,
  LOSS_GUARD_STEP,
  MAX_CORRECTION,
  MAX_LOSS_STREAK,
  MAX_WIN_STREAK,
  PRIOR_LIFE,
  PRIOR_SHORT,
  P_MAX,
  P_MIN,
  TARGETS,
  WIN_GUARD_BASE,
  WIN_GUARD_STEP,
  type LifecycleStage,
} from "./constants";
import { posterior, posteriorFromTotals } from "./estimator";
import type { AccountStats, ControllerOutput } from "./types";

export function stageFor(
  cumulativeDepositsMinor: number,
  isDemo: boolean,
): LifecycleStage {
  if (isDemo || cumulativeDepositsMinor <= 0) return "PRE_DEPOSIT";
  if (cumulativeDepositsMinor < DEPOSIT_THRESHOLD_MINOR) return "DEPOSITED";
  return "HIGH_VALUE";
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Minimum urgency every wish carries into resolveBucket. Without this floor a
 * user whose `p` sits at exactly 0.5 (target = 0.5, error 0, no ceiling)
 * contributes zero to the bucket score — their own trade could then be
 * resolved purely to serve a co-expiring wish. A tiny positive floor keeps
 * every trader with a non-zero say in their own outcome without meaningfully
 * distorting the resolver's tie-breaking.
 */
const URGENCY_FLOOR = 0.05;

export function desiredWinProb(stats: AccountStats): ControllerOutput {
  const target = TARGETS[stats.stage];

  const posteriorShort = posterior(stats.shortWindow, target, PRIOR_SHORT);
  const posteriorLife = posteriorFromTotals(
    stats.lifetimeWonWeight,
    stats.lifetimeTotalWeight,
    target,
    PRIOR_LIFE,
  );

  const windowWeight = stats.shortWindow.reduce((s, e) => s + e.weight, 0);
  const confidence = Math.min(windowWeight / CONFIDENCE_THRESHOLD, 1.0);

  const error = posteriorShort - target;
  let p = target - confidence * MAX_CORRECTION * Math.tanh(error / ERROR_SCALE);

  const ceilingPosterior = Math.max(posteriorShort, posteriorLife);
  const ceilingActive = ceilingPosterior > HARD_CEILING;

  // Ceiling clamp — spelled out. With MAX_CORRECTION=0.35, ERROR_SCALE/3≈0.047,
  // the pre-clamp `target - 0.35*tanh(excess/…)` is bounded in roughly
  // [target-0.35, target]. Since target ≥ 0.27 and CEILING_CLAMP is 0.03, the
  // Math.min(..., CEILING_CLAMP) branch always wins as long as the ceiling is
  // engaged — the tanh calculation was dead code. Pinning `ceilingP` directly
  // to CEILING_CLAMP is what the code actually computed; the linear blend
  // through `confidence` still governs how fast we get there.
  if (ceilingActive) {
    const ceilingP = CEILING_CLAMP;
    // `p + confidence * (ceilingP - p)` is a lerp from p toward ceilingP by
    // `confidence`. Confidence=1 pins p at ceilingP; confidence=0 leaves p
    // alone (bootstrap protection so a brand-new account with 5 wins can't
    // be crushed to 0.03 from the third trade).
    const blended = p + confidence * (ceilingP - p);
    // Only ever pull `p` DOWN through the ceiling — never up. Guards against
    // the pathological case where blended > p (would only happen if p was
    // already below the clamp, e.g. a HIGH_VALUE loser).
    p = Math.min(p, blended);
  }

  // Loss guard is deliberately OFF when the ceiling is active. A ceiling-
  // active user has an ELEVATED lifetime win rate — a fresh loss streak on
  // top of that is regression to the mean, not something to bail out of
  // with a forced win. Enabling the guard here would hand the streakiest
  // winners a free "reset" whenever the losses caught up. Locked in by the
  // A5 test in controller.test.ts.
  if (stats.lossStreak >= MAX_LOSS_STREAK && !ceilingActive) {
    const k = stats.lossStreak - MAX_LOSS_STREAK;
    const floor = LOSS_GUARD_BASE + LOSS_GUARD_STEP * (k + 1);
    p = Math.max(p, Math.min(floor, P_MAX));
  }
  if (stats.winStreak >= MAX_WIN_STREAK) {
    const k = stats.winStreak - MAX_WIN_STREAK;
    const ceil = (1 - WIN_GUARD_BASE) - WIN_GUARD_STEP * (k + 1);
    p = Math.min(p, Math.max(ceil, P_MIN));
  }

  p = clamp(p, P_MIN, P_MAX);

  // `|p - 0.5| * 2` gives the natural urgency (0 at target=0.5, 1 at either
  // extreme). The +1 boost on ceiling-active makes hot-streak users out-
  // shout the rest of the bucket. URGENCY_FLOOR keeps on-target users at
  // least visible in the resolver.
  const rawUrgency = Math.abs(p - 0.5) * 2 + (ceilingActive ? 1 : 0);
  const urgency = Math.max(rawUrgency, URGENCY_FLOOR);

  return { p, ceilingActive, urgency, posteriorShort, posteriorLife, target, stage: stats.stage };
}

export function drawOutcome(p: number, rng: { next(): number }): boolean {
  return rng.next() < p;
}
