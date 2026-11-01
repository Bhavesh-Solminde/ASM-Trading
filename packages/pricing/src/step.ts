import type { MsmParams } from "./msm";
import type { NewsParams } from "./news";

/**
 * The five-layer tick composer.
 *
 *   L1 base         GBM with MSM volatility and short-term momentum —
 *                   the honest random walk
 *   L2 drift        a small bounded bias
 *   L3 magnet       expiry convergence pull
 *   L4 anchor       weak pull toward a real market price
 *   L5 self-anchor  optional pull toward an internal reference (the
 *                   asset's own honest path)
 *
 * All layers combine in log space so the price can never go negative, then
 * the total move is clamped so no single tick can draw an implausible
 * candle.
 *
 * MSM volatility (`params.msm`) is EXOGENOUS: the asset owns an MsmState
 * that advances independently of the price, and the caller folds its
 * current layers × intraday × news into a single `volScale` scalar passed
 * each tick. Keeping that computation outside `stepPrice` means the shown
 * and honest paths see the exact same volatility, so divergence between
 * them reflects only the bias/magnet layers.
 */

export interface PriceParams {
  /** MSM volatility (src/msm.ts). Required — this engine is MSM-only. */
  readonly msm: MsmParams;
  /**
   * 24 UTC-hour volatility multipliers (src/intraday.ts). Applied via
   * `volScale` by the caller when the tick's wall-clock time is known.
   */
  readonly intraday?: readonly number[];
  /** Rare volatility spikes (src/news.ts). Applied via `volScale`. */
  readonly news?: NewsParams;
  /** Deterministic drift per second, in log space. Usually 0. */
  readonly driftPerSec: number;
  /** Anchor strength per tick (Layer 4). 0 disables anchoring entirely. */
  readonly anchorAlpha: number;
  /** Hard cap on absolute price movement in one tick. */
  readonly maxTickMove: number;
  /**
   * How long, in simulated SECONDS, a push in one direction tends to persist.
   * With independent ticks (0 / omitted — the default) the price zig-zags
   * inside every candle and the wicks end up about as long as the body
   * (bodies average only ~50-57% of the high-low range). Persistence makes
   * consecutive ticks lean the same way via an AR(1) on the shock, so
   * candles fill with body while long-run variance is preserved (trending
   * ticks redistribute volatility, they don't add it). At the live 5s
   * cadence 10–15 gives 1m bodies ~70-74%. Expressed in time rather than
   * per tick so retuning TICK_DT_SEC keeps the same candle shape.
   */
  readonly trendPersistenceSec?: number;
}

export interface PriceState {
  readonly price: number;
  /** Unit-variance shock carried from the previous tick (the momentum term). */
  readonly momentum: number;
}

export interface StepPriceInput {
  readonly state: PriceState;
  readonly params: PriceParams;
  readonly dtSec: number;
  /** Standard normal draw for this tick. */
  readonly z: number;
  /**
   * Exogenous volatility multiplier for this tick — MSM layers × intraday
   * factor, optionally combined with the current news-shock level. Computed
   * once per asset by the caller so the shown and honest paths share it.
   * Defaults to 1.
   */
  readonly volScale?: number;
  /** Layer 2. Log-space bias; the algo package bounds this to ±0.25·sigma. */
  readonly driftBias: number;
  /** Layer 3. Log-space pull toward an expiry target. */
  readonly magnet: number;
  /** Layer 4 target, or null when no real quote is available. */
  readonly anchorTarget: number | null;
  /**
   * Layer 5. Optional pull toward an INTERNAL reference — the asset's own
   * honest path. Same log-space proportional-pull shape as Layer 4 so it
   * composes cleanly with the others. Pass null (or omit both fields) to
   * disable the layer.
   */
  readonly selfAnchorTarget?: number | null;
  readonly selfAnchorAlpha?: number;
}

export interface StepPriceOutput {
  readonly state: PriceState;
  readonly price: number;
  /** The conditional volatility used for this tick — the algo scales bias from it. */
  readonly sigma: number;
}

/**
 * SECONDS BETWEEN PRICE UPDATES — the single source of truth for how often
 * the chart moves. The engine loop emits exactly one new price every
 * TICK_DT_SEC (loop.ts derives its setTimeout from this) and each update
 * advances the price by this much simulated time.
 *
 * At ~1s the price makes one decisive move and then HOLDS until the next
 * update (the client's brief easing glide settles well inside the interval),
 * instead of the constant sub-second "vibration" you get at small values.
 * Because the per-update move is `sigma·√dt·z`, per-SECOND volatility is
 * unchanged when you retune this — a 1s update simply moves in one larger
 * step rather than many tiny ones.
 */
export const TICK_DT_SEC = 3;

/** Per-tick standard deviation in log-price space. */
export function perTickSigma(sigma: number, dtSec: number = TICK_DT_SEC): number {
  return sigma * Math.sqrt(dtSec);
}

/** The volatility per √second this asset settles at in the long run. */
export function longRunSigma(params: PriceParams): number {
  return params.msm.sigma;
}

/** Volatility per √second before `volScale` — MSM's sigma. */
export function baseSigma(_state: PriceState, params: PriceParams): number {
  return params.msm.sigma;
}

export function initPriceState(basePrice: number, params: PriceParams): PriceState {
  if (!(basePrice > 0)) {
    throw new Error(`basePrice must be positive, received ${basePrice}`);
  }
  const persistence = params.trendPersistenceSec ?? 0;
  if (!(persistence >= 0)) {
    throw new Error(`trendPersistenceSec must be >= 0, received ${persistence}`);
  }
  if (!params.msm) throw new Error("PriceParams.msm is required");
  return { price: basePrice, momentum: 0 };
}

export function stepPrice(input: StepPriceInput): StepPriceOutput {
  const {
    state,
    params,
    dtSec,
    z,
    volScale = 1,
    driftBias,
    magnet,
    anchorTarget,
    selfAnchorTarget,
    selfAnchorAlpha,
  } = input;

  // Volatility. MSM is exogenous — the caller already folded its layers,
  // intraday factor and news level into `volScale`.
  const sigma = params.msm.sigma * volScale;

  // Momentum: an AR(1) on the shock so a move tends to continue for about
  // trendPersistenceSec. `momentum` stays unit-variance; `shock` is scaled
  // by sqrt((1 - phi) / (1 + phi)) so the long-run variance of the summed
  // moves is still sigma²·t — trending ticks redistribute volatility, they
  // don't add it. phi = 0 collapses this to the plain independent-z walk.
  const persistence = params.trendPersistenceSec ?? 0;
  const phi = persistence > 0 ? Math.exp(-dtSec / persistence) : 0;
  const momentum = phi * state.momentum + Math.sqrt(1 - phi * phi) * z;
  const shock = momentum * Math.sqrt((1 - phi) / (1 + phi));

  // L1 + L2 + L3 in log space.
  let logMove =
    params.driftPerSec * dtSec + sigma * Math.sqrt(dtSec) * shock + driftBias + magnet;

  // L4: anchoring is a proportional pull expressed in log space so it
  // composes with the others rather than fighting them.
  if (anchorTarget !== null && params.anchorAlpha > 0 && anchorTarget > 0) {
    logMove += params.anchorAlpha * Math.log(anchorTarget / state.price);
  }

  // L5: OTC self-anchor. Same proportional-pull shape as L4 but the target
  // is the caller-supplied internal reference. The per-call `selfAnchorAlpha`
  // governs it, not `params.anchorAlpha`, because L4 and L5 are independent
  // axes.
  if (
    selfAnchorTarget != null &&
    selfAnchorAlpha != null &&
    selfAnchorAlpha > 0 &&
    selfAnchorTarget > 0
  ) {
    logMove += selfAnchorAlpha * Math.log(selfAnchorTarget / state.price);
  }

  const candidate = state.price * Math.exp(logMove);

  // Clamp the realised move. This is the guard that stops a large magnet or
  // a freak draw from producing a candle nobody would believe.
  const delta = candidate - state.price;
  const clamped =
    Math.abs(delta) > params.maxTickMove
      ? state.price + Math.sign(delta) * params.maxTickMove
      : candidate;

  const price = clamped > 0 ? clamped : state.price;

  return { state: { price, momentum }, price, sigma };
}
