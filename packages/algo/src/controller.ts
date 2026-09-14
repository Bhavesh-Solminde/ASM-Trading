import {
  CEILING_CLAMP,
  CEILING_MARGIN,
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
  STREAK_NUDGE,
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

/**
 * The controller.
 *
 * Bounded proportional control on the Beta-Binomial posterior. tanh saturates
 * gracefully — a wildly off-target account gets a strong but finite correction,
 * never a runaway one.
 *
 * Streak guard is SOFT: once a streak reaches the threshold, p is nudged by
 * STREAK_NUDGE per extra trade until it resolves. This keeps the sequence
 * from failing a Wald-Wolfowitz runs test (which a hard 0.9/0.1 override fails).
 *
 * Ceiling is evaluated against MAX(posteriorShort, posteriorLife) so neither
 * a lucky recent window nor a lucky lifetime record can hide behind the other.
 * It is judged with a CEILING_MARGIN buffer to prevent oscillation at the boundary.
 */
export function desiredWinProb(
  stats: AccountStats,
  opts?: { stake?: number },
): ControllerOutput {
  void opts; // stake reserved for future per-trade weighting
  const target = TARGETS[stats.stage];

  const posteriorShort = posterior(stats.shortWindow, target, PRIOR_SHORT);
  const posteriorLife = posteriorFromTotals(
    stats.lifetimeWonWeight,
    stats.lifetimeTotalWeight,
    target,
    PRIOR_LIFE,
  );

  const error = posteriorShort - target;
  let p = target - MAX_CORRECTION * Math.tanh(error / ERROR_SCALE);

  // Ceiling: steeper gain because this is a constraint, not a target.
  const ceilingPosterior = Math.max(posteriorShort, posteriorLife);
  const ceilingActive = ceilingPosterior > HARD_CEILING + CEILING_MARGIN;

  if (ceilingActive) {
    const excess = ceilingPosterior - HARD_CEILING;
    p = Math.min(
      p,
      target - MAX_CORRECTION * Math.tanh(excess / (ERROR_SCALE / 3)),
    );
    p = Math.min(p, CEILING_CLAMP);
  }

  // Soft streak guard. Streak overrides sit AFTER the ceiling deliberately:
  // breaking a long loss streak matters more than one extra win above an
  // aggregate bound, because a visible streak is what makes someone suspect
  // the platform.
  if (stats.lossStreak >= MAX_LOSS_STREAK) {
    const extra = stats.lossStreak - MAX_LOSS_STREAK;
    p = Math.max(p, 0.5 + STREAK_NUDGE * (1 + extra));
  }
  if (stats.winStreak >= MAX_WIN_STREAK) {
    const extra = stats.winStreak - MAX_WIN_STREAK;
    p = Math.min(p, 0.5 - STREAK_NUDGE * (1 + extra));
  }

  p = clamp(p, P_MIN, P_MAX);

  const urgency = Math.abs(p - 0.5) * 2 + (ceilingActive ? 1 : 0);

  return {
    p,
    ceilingActive,
    urgency,
    posteriorShort,
    posteriorLife,
    target,
    stage: stats.stage,
  };
}

/**
 * Stochastic draw. Deciding "this account loses" produces sequences that fail
 * a runs test; drawing with probability p is literally a biased coin, which
 * cannot be distinguished from one.
 */
export function drawOutcome(p: number, rng: { next(): number }): boolean {
  return rng.next() < p;
}
