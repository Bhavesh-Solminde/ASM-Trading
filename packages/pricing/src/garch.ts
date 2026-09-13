/**
 * GARCH(1,1) conditional variance:
 *   sigma2(t) = omega + alpha * eps(t-1)^2 + beta * sigma2(t-1)
 *
 * Requires alpha + beta < 1 for stationarity. This is the term that gives the
 * synthetic series realistic volatility clustering; without it, candles look
 * uniformly noisy and read as fake immediately.
 */

export interface GarchParams {
  readonly omega: number;
  readonly alpha: number;
  readonly beta: number;
}

export interface GarchState {
  readonly sigma2: number;
  readonly lastEps: number;
}

export function initGarch(params: GarchParams): GarchState {
  const persistence = params.alpha + params.beta;
  if (persistence >= 1) {
    throw new Error(
      `GARCH is non-stationary: alpha + beta = ${persistence}, must be < 1`,
    );
  }
  return { sigma2: params.omega / (1 - persistence), lastEps: 0 };
}

export function stepGarch(
  state: GarchState,
  params: GarchParams,
  z: number,
): { state: GarchState; sigma: number } {
  const sigma = Math.sqrt(state.sigma2);
  const eps = sigma * z;
  const sigma2 =
    params.omega +
    params.alpha * eps * eps +
    params.beta * state.sigma2;
  return { state: { sigma2, lastEps: eps }, sigma };
}
