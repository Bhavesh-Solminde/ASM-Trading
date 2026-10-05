/**
 * House governor — decides a Trade's outcome at OPEN time.
 *
 * The verdict is a WIN/LOSS/HONEST label attached to the trade the moment
 * the user places it. The engine's magnet then steers the shown price toward
 * the outcome across the full trade duration, so settlement never has to snap
 * the chart. Demo trades always resolve to HONEST — the algorithm is invisible
 * on the demo side of the app. (The DEMO_WIN_RATE bias lives in the GLG
 * governor only — this legacy v2 governor keeps the HONEST short-circuit.)
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
  /**
   * Sum of stakes in the current LOSS streak, minor units. Feeds the mercy
   * payout-affordability cap: mercy only fires when a WIN's payout is
   * ≤ this amount, so users can't farm mercy by stacking tiny losses then
   * placing one huge trade.
   */
  userLossStreakStakeMinor: number;
  /** Currently unused directly; reserved for future tilt (VIP protection etc). */
  userIsHighValue: boolean;
  /** Trade stake in minor units. */
  tradeStakeMinor: number;
  /** Payout percentage the user is offered, e.g. 85 for a 1.85× win. */
  tradePayoutPct: number;
  /**
   * Minutes remaining until the current IST house-day rolls over. Feeds the
   * closing-window guard: when the day is nearly over AND the house is far
   * behind its target, mercy is clamped so users don't drag the house into
   * the red as the day ends.
   */
  minutesUntilDayEnd: number;
}

export interface GovernorConfig {
  /** Piecewise-linear ladder of [progress, pWin] points. progress = realized / target. */
  ladder: ReadonlyArray<readonly [progress: number, pWin: number]>;
  /** Loss-streak thresholds → mercy pWin floors. Higher streak wins ties. */
  mercy: ReadonlyArray<readonly [minStreak: number, pWinFloor: number]>;
  /** Absolute ceiling on pWin during giveback so the house never bleeds. */
  giveBackClampPWin: number;
  /**
   * Stake-value tilt. Bigger stakes tilt more toward LOSS because a lost
   * high-stake trade contributes more to the daily profit target and a won
   * high-stake trade drains more of the giveback budget.
   *
   *   effective pWin = base pWin × (referenceStakeMinor / stakeMinor)^stakeTiltExponent
   *
   * At stakeTiltExponent = 0 the tilt is disabled. At 0.5, a stake 4× the
   * reference halves pWin. Mercy floor is applied AFTER the tilt so no user
   * is trapped in the LOSS bucket forever.
   */
  referenceStakeMinor: number;
  stakeTiltExponent: number;
  /**
   * Mercy payout-affordability cap. Mercy floors only apply when the trade's
   * would-be payout is ≤ `mercyPayoutCapRatio × userLossStreakStakeMinor`.
   * At 1.0 (default) the payout on the mercy trade cannot exceed what the
   * user has already burned in the current streak — the house is at worst
   * flat over the streak-window. Set higher to be more generous, 0 disables
   * the cap entirely (reverts to pre-cap behavior).
   */
  mercyPayoutCapRatio: number;
  /**
   * Closing-window guard: within the last `closingWindowMinutes` of the IST
   * day, if daily progress is below `closingMinProgress`, pWin is clamped
   * to `closingClampPWin`. This prevents mercy or a soft ladder from
   * dragging the house into a losing day when there's no runway left to
   * grind back to target. Set `closingWindowMinutes` to 0 to disable.
   */
  closingWindowMinutes: number;
  closingMinProgress: number;
  closingClampPWin: number;
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
  referenceStakeMinor: 10_000, // ₹100
  stakeTiltExponent: 0.5,
  mercyPayoutCapRatio: 1.0,
  closingWindowMinutes: 240, // last 4 hours of the IST day (20:00–00:00)
  closingMinProgress: 0.5,
  closingClampPWin: 0.1,
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

  // Stake-value tilt: on the same daily-progress row, bigger stakes tilt
  // more toward LOSS. Applied BEFORE the mercy floor so a big-stake user on
  // a long losing streak can still get bailed out.
  if (config.stakeTiltExponent > 0 && input.tradeStakeMinor > 0) {
    const ratio = config.referenceStakeMinor / input.tradeStakeMinor;
    if (ratio < 1) {
      pWin *= Math.pow(ratio, config.stakeTiltExponent);
    }
    // stakes <= reference get no penalty (ratio >= 1 → factor >= 1, but the
    // ladder is already the baseline so we don't multiply UP).
  }

  // Would-be payout on a WIN (the "cost" to the house). Also used by the
  // giveback clamp below.
  const winCost = Math.round(
    (input.tradeStakeMinor * input.tradePayoutPct) / 100,
  );

  // Mercy floor: never let a user lose N in a row, BUT only when the
  // would-be payout is affordable given what they've already burned in the
  // current streak. This kills the "lose 4×$1, then place $100" farming
  // pattern: on the $100 trade, payout $85 > $4 losses → mercy skipped.
  // A ratio of 0 disables the affordability cap and reverts to raw mercy.
  const mercyAffordable =
    config.mercyPayoutCapRatio <= 0 ||
    winCost <= config.mercyPayoutCapRatio * input.userLossStreakStakeMinor;
  if (mercyAffordable) {
    for (const [minStreak, floor] of config.mercy) {
      if (input.userLossStreak >= minStreak) {
        pWin = Math.max(pWin, floor);
      }
    }
  }

  // Closing-window guard: near the end of the IST day, if the house is
  // behind its target, we won't hand out wins — including mercy wins. There
  // isn't enough runway left to grind back what we give away.
  if (
    config.closingWindowMinutes > 0 &&
    input.minutesUntilDayEnd <= config.closingWindowMinutes &&
    progress < config.closingMinProgress
  ) {
    pWin = Math.min(pWin, config.closingClampPWin);
  }

  // Giveback protection: once we're over target, a win must not drop realized
  // below target again. If it would, cap pWin so we don't giveback more than
  // the day's overage.
  if (progress > 1 && realized - winCost < target) {
    pWin = Math.min(pWin, config.giveBackClampPWin);
  }

  // Clamp to [0, 1] just in case a config author made pWin > 1 somewhere.
  pWin = Math.max(0, Math.min(1, pWin));

  return rng() < pWin ? "WIN" : "LOSS";
}
