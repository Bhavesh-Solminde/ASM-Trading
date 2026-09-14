export type LifecycleStage = "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";

/**
 * Stage targets. Pre-deposit generosity builds confidence; the rate falls once
 * an account has deposited, and falls again past the high-value threshold.
 */
export const TARGETS: Record<LifecycleStage, number> = {
  PRE_DEPOSIT: 0.65,
  DEPOSITED: 0.45,
  HIGH_VALUE: 0.27,
};

/** No account sustains a win rate above this, in any stage. */
export const HARD_CEILING = 0.65;
/** Win probability applied while an account is over the ceiling. */
export const CEILING_CLAMP = 0.15;
/**
 * Margin above HARD_CEILING used to judge whether the ceiling is engaged.
 * Prevents oscillation at exactly the ceiling boundary.
 */
export const CEILING_MARGIN = 0.03;

/** Largest shift the controller may apply away from the stage target. */
export const MAX_CORRECTION = 0.35;
/** Controller sensitivity — the error at which tanh reaches ~0.76. */
export const ERROR_SCALE = 0.15;

/** Beta-Binomial prior strength, in weight units. */
export const PRIOR_SHORT = 15;
export const PRIOR_LIFE = 30;
/** Rolling window length, in trades. */
export const WINDOW_SIZE = 100;

/**
 * Anti-farming bounds on a single trade's influence.
 * WEIGHT_FLOOR of 0.1: a hundred one-rupee trades count for ten, not a hundred,
 * so an attacker cannot cheaply drag their posterior down before a large bet.
 * Reference stake is floored at 1_000 to resist median manipulation.
 */
export const WEIGHT_FLOOR = 0.1;
export const WEIGHT_CAP = 5.0;
export const WEIGHT_REFERENCE_FLOOR = 1_000;

/**
 * Soft streak guard. Once a streak reaches the threshold, p is nudged by
 * STREAK_NUDGE per extra trade until it resolves. The nudge is soft so the
 * sequence still passes a runs test.
 */
export const MAX_LOSS_STREAK = 9;
export const MAX_WIN_STREAK = 8;
export const STREAK_NUDGE = 0.08;

/** Absolute bounds — no account can ever be certain to win or lose. */
export const P_MIN = 0.05;
export const P_MAX = 0.95;

/**
 * Below EXPOSURE_FLOOR the price runs completely unbiased — a small book is not
 * worth defending, and one small trade must never move a market. Bias ramps
 * linearly to full strength at EXPOSURE_FULL. Both in minor units.
 */
export const EXPOSURE_FLOOR = 50_000;
export const EXPOSURE_FULL = 500_000;

/** Hard cap on drift bias, in multiples of per-tick sigma. */
export const BIAS_SIGMA_CAP = 0.25;

/** Time-decay constant for weighting near-expiry positions more heavily. */
export const IMBALANCE_TAU_SEC = 45;

/**
 * Expiry magnet acts only in the final MAGNET_WINDOW_SEC seconds of a bucket.
 * Capped at MAGNET_CAP × sigmaTick per tick.
 */
export const MAGNET_WINDOW_SEC = 10;
export const MAGNET_CAP = 1.5;

/**
 * Target sits TARGET_MARGIN_SIGMA × sigmaTick past the entry price,
 * so it is clearly on the winning or losing side.
 */
export const TARGET_MARGIN_SIGMA = 3;

/** Cumulative deposits (minor units) at which DEPOSITED → HIGH_VALUE. */
export const DEPOSIT_THRESHOLD_MINOR = 50_000;

/** House P&L tiebreaker in bucket resolution, normalised to [-1, 1]. */
export const BOOK_WEIGHT = 0.001;
