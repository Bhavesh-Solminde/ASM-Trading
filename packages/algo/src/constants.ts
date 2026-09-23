export type LifecycleStage = "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";

export const TARGETS: Record<LifecycleStage, number> = {
  PRE_DEPOSIT: 0.65,
  DEPOSITED: 0.45,
  HIGH_VALUE: 0.27,
};

export const HARD_CEILING = 0.65;
export const CEILING_CLAMP = 0.03;

export const MAX_CORRECTION = 0.35;
export const ERROR_SCALE = 0.14;

export const PRIOR_SHORT = 15;
export const PRIOR_LIFE = 30;
export const WINDOW_SIZE = 100;

export const WEIGHT_FLOOR = 0.16;
export const WEIGHT_CAP = 5.0;

export const MAX_LOSS_STREAK = 8;
export const MAX_WIN_STREAK = 15;

export const LOSS_GUARD_BASE = 0.98;
export const LOSS_GUARD_STEP = 0.01;
export const WIN_GUARD_BASE = 0.50;
export const WIN_GUARD_STEP = 0.15;

export const P_MIN = 0.01;
export const P_MAX = 0.99;

export const PLAUSIBILITY = 2.0;
export const BOOK_WEIGHT = 0.001;

export const EXPOSURE_FLOOR = 50_000;
export const EXPOSURE_FULL = 500_000;

export const BIAS_SIGMA_CAP = 0.25;

export const IMBALANCE_TAU_SEC = 45;

/**
 * Maximum fraction of the total book weight any single position may contribute
 * to the imbalance calculation. Without this, a whale bet of ₹10 lakh among 99
 * ₹100 traders would set the direction unilaterally — the crowd's aggregate
 * would have no voice. Capping each position's contribution at 30% of total
 * means at least 3 co-directional positions are needed to fully define the
 * imbalance direction, so a lone whale is diluted by the surrounding book.
 */
export const WHALE_CAP_FRACTION = 0.3;

export const CONFIDENCE_THRESHOLD = 30;

export const DEPOSIT_THRESHOLD_MINOR = 50_000;

export const MAGNET_WINDOW_SEC = 10;
export const MAGNET_CAP = 1.5;
export const TARGET_MARGIN_SIGMA = 3;
