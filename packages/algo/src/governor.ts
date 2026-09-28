/**
 * House governor — decides a Trade's outcome at OPEN time.
 *
 * The verdict is a WIN/LOSS/HONEST label attached to the trade the moment
 * the user places it. The engine's magnet then steers the shown price toward
 * the outcome across the full trade duration, so settlement never has to snap
 * the chart. Demo trades always resolve to HONEST — the algorithm is invisible
 * on the demo side of the app.
 *
 * Win probability rises smoothly with the house's progress toward its daily
 * ₹ target (piecewise-linear `ladder`). Anti-tilt is layered on top: a user
 * on a long losing streak gets a mercy floor so they don't rage-quit, and a
 * target-floor clamp prevents overshoot into giveback from wiping out the
 * day's profit.
 */

export type Verdict = "WIN" | "LOSS" | "HONEST";

export interface GovernorInput {
  /** Demo trades short-circuit to HONEST. */
  isDemo: boolean;
  /** Admin-set daily house profit target, in minor units (paise). */
  dailyTargetMinor: number;
  /** House profit realized so far today, in minor units. */
  realizedTodayMinor: number;
  /** Consecutive losses on this user's most recent settled live trades. */
  userLossStreak: number;
  /** Currently unused directly; reserved for future tilt (VIP protection etc). */
  userIsHighValue: boolean;
  /** Trade stake in minor units. */
  tradeStakeMinor: number;
  /** Payout percentage the user is offered, e.g. 85 for a 1.85× win. */
  tradePayoutPct: number;
}

export interface GovernorConfig {
  /** Piecewise-linear ladder of [progress, pWin] points. progress = realized / target. */
  ladder: ReadonlyArray<readonly [progress: number, pWin: number]>;
  /** Loss-streak thresholds → mercy pWin floors. Higher streak wins ties. */
  mercy: ReadonlyArray<readonly [minStreak: number, pWinFloor: number]>;
  /** Absolute ceiling on pWin during giveback so the house never bleeds. */
  giveBackClampPWin: number;
}

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  ladder: [
    [0.0, 0.05],
    [0.1, 0.05],
    [0.5, 0.15],
    [1.0, 0.4],
    [1.5, 0.6],
    [2.0, 0.75],
    [10.0, 0.9],
  ],
  mercy: [
    [4, 0.55],
    [6, 0.8],
  ],
  giveBackClampPWin: 0.25,
};

/**
 * Piecewise-linear interpolation over sorted ladder points. Values outside
 * the range clamp to the nearest endpoint (no extrapolation).
 */
export function ladder(
  progress: number,
  points: GovernorConfig["ladder"] = DEFAULT_GOVERNOR_CONFIG.ladder,
): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (progress <= first[0]) return first[1];
  if (progress >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (progress <= x1) {
      const [x0, y0] = points[i - 1]!;
      const t = (progress - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * Decide a verdict. `rng` returns a uniform [0, 1); inject a seeded RNG in
 * tests, or `Math.random` in production.
 */
export function decideVerdict(
  input: GovernorInput,
  rng: () => number,
  config: GovernorConfig = DEFAULT_GOVERNOR_CONFIG,
): Verdict {
  if (input.isDemo) return "HONEST";

  const target = input.dailyTargetMinor;
  const realized = input.realizedTodayMinor;
  // With no target set (target = 0) we treat the day as fully-covered → giveback.
  const progress = target > 0 ? realized / target : 1;

  let pWin = ladder(progress, config.ladder);

  // Mercy floor: never let a user lose N in a row. Iterate so the highest
  // matching threshold wins even if the config is unsorted.
  for (const [minStreak, floor] of config.mercy) {
    if (input.userLossStreak >= minStreak) {
      pWin = Math.max(pWin, floor);
    }
  }

  // Giveback protection: once we're over target, a win must not drop realized
  // below target again. If it would, cap pWin so we don't giveback more than
  // the day's overage.
  const winCost = Math.round(
    (input.tradeStakeMinor * input.tradePayoutPct) / 100,
  );
  if (progress > 1 && realized - winCost < target) {
    pWin = Math.min(pWin, config.giveBackClampPWin);
  }

  // Clamp to [0, 1] just in case a config author made pWin > 1 somewhere.
  pWin = Math.max(0, Math.min(1, pWin));

  return rng() < pWin ? "WIN" : "LOSS";
}
