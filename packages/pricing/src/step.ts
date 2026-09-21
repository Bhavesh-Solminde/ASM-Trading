import { initGarch, stepGarch, type GarchParams, type GarchState } from "./garch";

/**
 * The four-layer tick composer.
 *
 *   L1 base      GBM with GARCH volatility — the honest random walk
 *   L2 drift     a small bounded bias (Plan 04 supplies it; 0 here)
 *   L3 magnet    expiry convergence pull (Plan 04 supplies it; 0 here)
 *   L4 anchor    weak pull toward a real market price
 *
 * All four combine in log space so the price can never go negative, then the
 * total move is clamped so no single tick can draw an implausible candle.
 */

export interface PriceParams {
  readonly garch: GarchParams;
  /** Deterministic drift per second, in log space. Usually 0. */
  readonly driftPerSec: number;
  /** Anchor strength per tick. 0 disables anchoring entirely. */
  readonly anchorAlpha: number;
  /** Hard cap on absolute price movement in one tick. */
  readonly maxTickMove: number;
}

export interface PriceState {
  readonly price: number;
  readonly garch: GarchState;
}

export interface StepPriceInput {
  readonly state: PriceState;
  readonly params: PriceParams;
  readonly dtSec: number;
  /** Standard normal draw for this tick. */
  readonly z: number;
  /** Layer 2. Log-space bias. Plan 04 bounds this to ±0.25·sigma. */
  readonly driftBias: number;
  /** Layer 3. Log-space pull toward an expiry target. */
  readonly magnet: number;
  /** Layer 4 target, or null when no real quote is available. */
  readonly anchorTarget: number | null;
}

export interface StepPriceOutput {
  readonly state: PriceState;
  readonly price: number;
  /** The conditional volatility used for this tick — Plan 04 needs it to scale bias. */
  readonly sigma: number;
}

/**
 * SECONDS BETWEEN PRICE UPDATES — the single source of truth for how often the
 * chart moves. This is the one number to change: set it to 1 for one update per
 * second, 0.5 for two per second, 2 for one every two seconds. The engine loop
 * emits exactly one new price every TICK_DT_SEC (loop.ts derives its setTimeout
 * from this) and each update advances the price by this much simulated time.
 *
 * At ~1s the price makes one decisive move and then HOLDS until the next update
 * (the client's brief easing glide settles well inside the interval), instead
 * of the constant sub-second "vibration" you get at small values. Because the
 * per-update move is `sigma·√dt·z`, per-SECOND volatility is unchanged when you
 * retune this — a 1s update simply moves in one larger step rather than many
 * tiny ones, so the market stays as lively, it just steps instead of shimmering.
 * All bias/magnet caps are expressed in these units.
 */
export const TICK_DT_SEC = 4; // one update per second — change this to taste

/**
 * Per-tick standard deviation in log-price space.
 * Use this whenever you need sigmaTick for bias/magnet capping.
 */
export function perTickSigma(sigma: number, dtSec: number = TICK_DT_SEC): number {
  return sigma * Math.sqrt(dtSec);
}

export function initPriceState(
  basePrice: number,
  params: PriceParams,
): PriceState {
  if (!(basePrice > 0)) {
    throw new Error(`basePrice must be positive, received ${basePrice}`);
  }
  return { price: basePrice, garch: initGarch(params.garch) };
}

export function stepPrice(input: StepPriceInput): StepPriceOutput {
  const { state, params, dtSec, z, driftBias, magnet, anchorTarget } = input;

  const { state: garch, sigma } = stepGarch(state.garch, params.garch, z);

  // L1 + L2 + L3 in log space.
  let logMove =
    params.driftPerSec * dtSec + sigma * Math.sqrt(dtSec) * z + driftBias + magnet;

  // L4: anchoring is a proportional pull expressed in log space so it composes
  // with the others rather than fighting them.
  if (anchorTarget !== null && params.anchorAlpha > 0 && anchorTarget > 0) {
    logMove += params.anchorAlpha * Math.log(anchorTarget / state.price);
  }

  const candidate = state.price * Math.exp(logMove);

  // Clamp the realised move. This is the guard that stops a large magnet or a
  // freak draw from producing a candle nobody would believe.
  const delta = candidate - state.price;
  const clamped =
    Math.abs(delta) > params.maxTickMove
      ? state.price + Math.sign(delta) * params.maxTickMove
      : candidate;

  const price = clamped > 0 ? clamped : state.price;

  return { state: { price, garch }, price, sigma };
}
