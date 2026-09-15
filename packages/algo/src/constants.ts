export type LifecycleStage = "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";

export const TARGETS: Record<LifecycleStage, number> = {
  PRE_DEPOSIT: 0.65,
  DEPOSITED: 0.45,
  HIGH_VALUE: 0.27,
};

export const HARD_CEILING = 0.65;
export const CEILING_CLAMP = 0.15;

export const MAX_CORRECTION = 0.35;
export const ERROR_SCALE = 0.15;

export const PRIOR_SHORT = 15;
export const PRIOR_LIFE = 30;
export const WINDOW_SIZE = 100;

export const WEIGHT_FLOOR = 0.2;
export const WEIGHT_CAP = 5.0;

export const MAX_LOSS_STREAK = 5;
export const MAX_WIN_STREAK = 4;

export const P_MIN = 0.05;
export const P_MAX = 0.95;

export const PLAUSIBILITY = 2.0;
export const BOOK_WEIGHT = 0.001;

export const EXPOSURE_FLOOR = 50_000;
export const EXPOSURE_FULL = 500_000;

export const BIAS_SIGMA_CAP = 0.25;

export const IMBALANCE_TAU_SEC = 45;

export const DEPOSIT_THRESHOLD_MINOR = 50_000;
