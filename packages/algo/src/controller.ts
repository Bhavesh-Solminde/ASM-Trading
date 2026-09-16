import {
  CEILING_CLAMP,
  CONFIDENCE_THRESHOLD,
  DEPOSIT_THRESHOLD_MINOR,
  ERROR_SCALE,
  HARD_CEILING,
  MAX_CORRECTION,
  MAX_LOSS_STREAK,
  MAX_WIN_STREAK,
  PRIOR_LIFE,
  PRIOR_SHORT,
  P_MAX,
  P_MIN,
  TARGETS,
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

  if (ceilingActive) {
    const excess = ceilingPosterior - HARD_CEILING;
    let ceilingP = target - MAX_CORRECTION * Math.tanh(excess / (ERROR_SCALE / 3));
    ceilingP = Math.min(ceilingP, CEILING_CLAMP);
    p = Math.min(p, p + confidence * (ceilingP - p));
  }

  if (stats.lossStreak >= MAX_LOSS_STREAK && !ceilingActive) {
    const k = stats.lossStreak - MAX_LOSS_STREAK;
    const floor = 0.98 + 0.01 * (k + 1);
    p = Math.max(p, Math.min(floor, P_MAX));
  }
  if (stats.winStreak >= MAX_WIN_STREAK) {
    const k = stats.winStreak - MAX_WIN_STREAK;
    const ceil = 0.50 - 0.15 * (k + 1);
    p = Math.min(p, Math.max(ceil, P_MIN));
  }

  p = clamp(p, P_MIN, P_MAX);

  const urgency = Math.abs(p - 0.5) * 2 + (ceilingActive ? 1 : 0);

  return { p, ceilingActive, urgency, posteriorShort, posteriorLife, target };
}

export function drawOutcome(p: number, rng: { next(): number }): boolean {
  return rng.next() < p;
}
