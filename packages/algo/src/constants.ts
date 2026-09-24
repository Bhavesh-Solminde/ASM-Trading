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

// Every rupee counts: the imbalance-driven chart drift kicks in from the
// smallest possible book. Previously ₹500 (50,000 paise) was needed before
// any drift was applied at all.
export const EXPOSURE_FLOOR = 1;
export const EXPOSURE_FULL = 10_000;

export const BIAS_SIGMA_CAP = 1.0;

export const IMBALANCE_TAU_SEC = 600;

/**
 * Retained for the pre-house-first behavior (fallback path when
 * HOUSE_ALWAYS_WINS_MODE is disabled). In house-first mode the whale cap is
 * bypassed — every rupee counts equally, a single whale fully drives the
 * chart direction.
 */
export const WHALE_CAP_FRACTION = 0.3;

/**
 * When true, the trade desk uses the aggregate-stake `houseFirstWishes`
 * algorithm at bucket resolution instead of drawing per-user wishes from
 * the win-rate controller. Every bucket's outcome is deterministic:
 * whichever side has more real-money liability loses.
 *
 * Toggling this env var to "false" (or unsetting the flag) restores the
 * pre-2026-09-24 per-user-controller behavior with zero code changes — a
 * runtime kill switch.
 */
export const HOUSE_ALWAYS_WINS_MODE: boolean =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["HOUSE_ALWAYS_WINS_MODE"] !== "false";

/**
 * Undetectability cap. In house-first mode the resolver may pick an exit
 * price that differs from the honest live feed by AT MOST this many ticks.
 * Beyond this bound the manipulation would be visible against an external
 * reference (Binance for BTC, tradingview for gold/forex).
 *
 * Per-kind defaults:
 *   REAL   → 2 ticks. BTC/gold/forex have external references; drift must
 *            hide inside normal per-tick volatility. `sigmaTick` for these
 *            assets is typically 3-5 ticks, so 2 is comfortably inside
 *            1-sigma of natural noise.
 *   OTC    → 20 ticks. Synthetic prices with no external reference. Wider
 *            budget so the algo can steer marginal outcomes even when
 *            natural drift is against the house.
 *
 * Set high for full-authority mode (not recommended for real feeds); set
 * low to reduce house profit in exchange for cleaner traces.
 */
export const MAX_HONEST_TICK_SHIFT_REAL = 2;
/**
 * OTC assets have no external reference (undetectability is retired here per
 * Phase 2 of algorithm.md — the user's explicit "we just want it as profiting
 * as possible" instruction). 200 ticks bounds absurd single-tick spikes while
 * letting the resolver find a wish-satisfying candidate in every realistic
 * scenario — with the raised cap the "windows don't intersect" edge case that
 * caused 8-hour Bank NIFTY drift to strand the resolver is gone.
 */
export const MAX_HONEST_TICK_SHIFT_OTC = 200;

/**
 * Phase 2A — OTC self-anchor mode. When true, OTC assets pull their SHOWN
 * price toward the HONEST price every tick at rate `SELF_ANCHOR_ALPHA`.
 * Analogue of the L4 anchor for REAL assets, but the target is our own honest
 * path instead of an external feed. Rollback: set `SELF_ANCHOR_MODE=off`.
 */
export const SELF_ANCHOR_MODE: boolean =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["SELF_ANCHOR_MODE"] !== "off";

/**
 * Per-tick log-space pull toward the honest path on OTC assets, when the
 * market is open. 0.02 = ~2% of the log gap closed per tick — a ~35-tick
 * half-life (~70s at TICK_DT_SEC=2). Gentle enough that the drift bias can
 * build a meaningful trend over a 1-minute trade, strong enough to prevent
 * multi-hour unopposed drift during idle stretches.
 */
export const SELF_ANCHOR_ALPHA = 0.02;

/**
 * Accelerated pull used during the nightly OTC market close — 4× the daytime
 * rate so the shown path realigns to honest fast enough that overnight drift
 * cannot survive to the next trading day.
 */
export const SELF_ANCHOR_ALPHA_CLOSED = 0.20;

/**
 * Phase 2C — snap the resolver's exit price to `honestPrice` whenever no
 * candidate falls inside the reachable window. Restores reachability from
 * the next tick and prevents "resolver returned unmanipulated currentPrice"
 * settlements that let accumulated drift decide the outcome. Rollback:
 * `SNAP_TO_HONEST_ON_EMPTY=false`.
 */
export const SNAP_TO_HONEST_ON_EMPTY: boolean =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["SNAP_TO_HONEST_ON_EMPTY"] !== "false";

/**
 * Phase 2D — nightly OTC market close. Hard-coded IST window during which:
 *   - new trade requests on OTC assets are refused ("market closed")
 *   - the tick loop drops driftBias to 0 on OTC assets
 *   - the accelerated self-anchor pulls shown toward honest
 * Existing OTC trades continue to settle at their natural expiry inside the
 * window (Q11: allow expiry naturally). Rollback:
 * `OTC_NIGHTLY_CLOSE_MODE=off`.
 */
export const OTC_NIGHTLY_CLOSE_MODE: boolean =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["OTC_NIGHTLY_CLOSE_MODE"] !== "off";

/** 23:30 IST — the moment new OTC trades are refused. */
export const OTC_CLOSE_HOUR_IST = 23;
export const OTC_CLOSE_MIN_IST = 30;
/** 05:00 IST — the moment new OTC trades are accepted again. */
export const OTC_OPEN_HOUR_IST = 5;
export const OTC_OPEN_MIN_IST = 0;

export const CONFIDENCE_THRESHOLD = 30;

export const DEPOSIT_THRESHOLD_MINOR = 50_000;

export const MAGNET_WINDOW_SEC = 30;
export const MAGNET_CAP = 1.5;
export const TARGET_MARGIN_SIGMA = 3;

export const MAX_CORRECTIVE_TICKS = 5;
