/**
 * Markov-switching multifractal (MSM) volatility — Calvet & Fisher.
 *
 * Volatility is the product of several independent "layers". Each layer holds
 * either m0 or 2 − m0 (so it averages 1) and now and then re-draws its value
 * (a coin flip, so a re-draw changes it half the time). The layers differ
 * only in how often they re-draw: the fastest every few seconds, the slowest
 * about every few days, with the intervals spaced geometrically. That is
 * Calvet–Fisher's gamma_k = 1 − (1 − gamma_1)^(b^(k−1)) written in durations
 * so retuning the tick cadence keeps the same behaviour.
 *
 * Busy and quiet stretches nest inside each other on every time scale, which
 * is what gives real markets long volatility memory and fat tails — things
 * GARCH(1,1) run per tick forgets within a few dozen ticks. The volatility
 * state never looks at the price, so the shown and honest paths share one
 * MSM state per asset.
 */

export interface MsmParams {
  /** Long-run volatility of log price per √second. */
  readonly sigma: number;
  /** Number of volatility layers. 8 is the usual choice. */
  readonly components: number;
  /** Layer values are m0 or 2 − m0. 1 = no effect; ~1.5 matches real markets. */
  readonly m0: number;
  /** Mean time between re-draws of the fastest layer, in simulated seconds. */
  readonly fastestSec: number;
  /** Mean time between re-draws of the slowest layer, in simulated seconds. */
  readonly slowestSec: number;
}

export interface MsmState {
  /** Current value of each layer, slowest first. */
  readonly layers: readonly number[];
}

function validate(params: MsmParams): void {
  const { sigma, components, m0, fastestSec, slowestSec } = params;
  if (!(sigma > 0)) throw new Error(`msm.sigma must be positive, received ${sigma}`);
  if (!Number.isInteger(components) || components < 1) {
    throw new Error(`msm.components must be a positive integer, received ${components}`);
  }
  if (!(m0 > 0 && m0 < 2)) throw new Error(`msm.m0 must be in (0, 2), received ${m0}`);
  if (!(fastestSec > 0 && slowestSec >= fastestSec)) {
    throw new Error(
      `msm needs 0 < fastestSec <= slowestSec, received ${fastestSec}, ${slowestSec}`,
    );
  }
}

/** Mean re-draw interval of each layer, slowest first, geometric spacing. */
export function msmDurations(params: MsmParams): number[] {
  const { components, fastestSec, slowestSec } = params;
  if (components === 1) return [slowestSec];
  return Array.from(
    { length: components },
    (_, k) => slowestSec * (fastestSec / slowestSec) ** (k / (components - 1)),
  );
}

const drawLayer = (m0: number, uniform: () => number): number =>
  uniform() < 0.5 ? m0 : 2 - m0;

export function initMsm(params: MsmParams, uniform: () => number): MsmState {
  validate(params);
  return {
    layers: Array.from({ length: params.components }, () => drawLayer(params.m0, uniform)),
  };
}

/**
 * The quiet floor, in units of the raw multiplier.
 *
 * Raw MSM has no lower bound worth the name: with 8 layers at m0 = 1.55 the
 * multiplier bottoms out at 0.041, i.e. the price stops moving. A real market
 * never does that, because even in the deadest hour the printed price still
 * bounces on the bid-ask spread — microstructure noise that MSM, a pure
 * volatility model, does not represent. Below this floor our chart freezes
 * onto two or three display levels and draws identical wickless rectangles.
 *
 * 0.45 clamps the quietest ~36% of regimes while leaving the busy end (up to
 * ~5.6×) untouched, so volatility clustering survives intact.
 */
export const MSM_QUIET_FLOOR = 0.45;

/**
 * E[m²] after clamping at MSM_QUIET_FLOOR, for one (m0, components) pair.
 *
 * Each layer is m0 or 2 − m0 with equal probability, so the raw multiplier
 * takes `components + 1` distinct values with binomial weights — small enough
 * to sum exactly rather than estimate. Memoised because `msmMultiplier` runs
 * once per asset per tick.
 */
const renormCache = new Map<string, number>();

function quietFloorRenorm(params: MsmParams): number {
  const key = `${params.m0}:${params.components}`;
  const cached = renormCache.get(key);
  if (cached !== undefined) return cached;

  const { m0, components } = params;
  let secondMoment = 0;
  let binomial = 1; // C(components, k), built up as k advances
  for (let k = 0; k <= components; k++) {
    if (k > 0) binomial = (binomial * (components - k + 1)) / k;
    const raw = Math.sqrt(m0 ** k * (2 - m0) ** (components - k));
    const floored = raw < MSM_QUIET_FLOOR ? MSM_QUIET_FLOOR : raw;
    secondMoment += (binomial / 2 ** components) * floored * floored;
  }

  // Clamping only ever raises the multiplier, so E[m²] > 1 afterwards; scale
  // it back so the long-run variance is still exactly sigma². Without this
  // the floor would quietly make every market livelier than its calibration.
  const renorm = 1 / Math.sqrt(secondMoment);
  renormCache.set(key, renorm);
  return renorm;
}

/**
 * sqrt(product of layers), floored at MSM_QUIET_FLOOR and renormalised so its
 * square still averages 1 — sigma stays the long-run level.
 *
 * `params` is required (rather than defaulted) so every caller — the live
 * loop, the startup backfill, the offline prefill scripts — shares one
 * definition of the floor. A backfill that skipped it would draw historical
 * candles in a different shape from the live ones that follow.
 */
export function msmMultiplier(state: MsmState, params: MsmParams): number {
  const raw = Math.sqrt(state.layers.reduce((a, b) => a * b, 1));
  const floored = raw < MSM_QUIET_FLOOR ? MSM_QUIET_FLOOR : raw;
  return floored * quietFloorRenorm(params);
}

/**
 * The multiplier of the typical regime — the median over the layer draws.
 *
 * Worth having a name because it is NOT 1. `msmMultiplier` is the square root
 * of a product whose square averages 1, and a square root is concave, so the
 * mean sits well above the median: at m0 = 1.55 the long-run average is 1 but
 * half of all regimes are quieter than 0.47, with the average carried by rare
 * bursts. Any question of the form "how far does this market move on an
 * ordinary day" has to be asked at the median, not at sigma.
 *
 * With an even layer count the median state is half the layers high and half
 * low, which is exact rather than estimated.
 */
export function msmMedianMultiplier(params: MsmParams): number {
  const { m0, components } = params;
  const high = Math.floor(components / 2);
  const raw = Math.sqrt(m0 ** high * (2 - m0) ** (components - high));
  const floored = raw < MSM_QUIET_FLOOR ? MSM_QUIET_FLOOR : raw;
  return floored * quietFloorRenorm(params);
}

/** Advance every layer by dtSec. Consumes one uniform per layer plus one per re-draw. */
export function stepMsm(
  state: MsmState,
  params: MsmParams,
  dtSec: number,
  uniform: () => number,
): MsmState {
  const durations = msmDurations(params);
  const layers = state.layers.map((value, k) =>
    uniform() < 1 - Math.exp(-dtSec / durations[k]!) ? drawLayer(params.m0, uniform) : value,
  );
  return { layers };
}
