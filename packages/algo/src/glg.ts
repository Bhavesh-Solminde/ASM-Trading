/**
 * Growth-Loop Governor (GLG) — phase 1 decision layer.
 *
 * Decides a Trade's outcome at OPEN time based ONLY on cumulative house
 * treasury vs a treasury target. No time component, no day-boundary reset,
 * no closing window. The single shared signal (treasury health) can only be
 * moved by settled trades, and users can only lower it by winning, which is
 * negative-EV for them by construction. This makes the algorithm structurally
 * un-timeable.
 *
 * Phase 1 covers: treasury-driven basePwin, per-asset payout ceiling,
 * giveback protection. Phase 2 will layer on loyalty boost + hardened mercy.
 * Phase 3 will add the coordination guard for opposite-direction hedges.
 *
 * Invariants (must hold under all inputs):
 *   I1  pWin ≤ 100 / (100 + payoutPct) - PER_ASSET_EDGE_MARGIN  (per asset)
 *   I2  pWin ≤ GLG_PWIN_CEILING                                  (global)
 *   I3  A WIN cannot drop treasury below treasuryTarget × GIVEBACK_CUSHION
 *   I4  E[house PnL per trade] > 0 for every state               (from I1)
 *
 * See doc: Growth-Loop Governor — Design & Migration Plan.
 */

export type GlgVerdict = "WIN" | "LOSS" | "HONEST";

export interface GlgInput {
  /** Demo trades short-circuit to HONEST. */
  isDemo: boolean;
  /** Cumulative house treasury in minor units. Can be negative (rare). */
  treasuryMinor: number;
  /** Treasury target from HouseTreasury or fallback, minor units. */
  treasuryTargetMinor: number;
  /** Trade stake, minor units. */
  tradeStakeMinor: number;
  /** Payout percentage the user is offered, e.g. 85 for a 1.85× win. */
  tradePayoutPct: number;
}

export interface GlgConfig {
  /** Piecewise-linear ladder of [health, pWin] points. Health = treasury / target. */
  basePwinLadder: ReadonlyArray<readonly [health: number, pWin: number]>;
  /** Absolute global ceiling on pWin under all conditions. */
  pwinCeiling: number;
  /** Safety margin below break-even applied per asset (protects house edge). */
  perAssetEdgeMargin: number;
  /**
   * When a WIN would drop treasuryMinor below treasuryTarget × givebackCushion,
   * clamp pWin to givebackClampPwin. Protects the treasury from bleeding back
   * through the target on a lucky streak.
   */
  givebackCushion: number;
  givebackClampPwin: number;
  /**
   * Stake-tilt: higher-stake trades get a lower pWin so a big win doesn't
   * drain the treasury. pWin is multiplied by
   * (referenceStakeMinor / tradeStakeMinor) ^ stakeTiltExponent, applied
   * only when tradeStakeMinor > referenceStakeMinor. Default reference =
   * ₹10, exponent 0.7 → a ₹100 stake (10× ref) gets pWin * ~0.20.
   */
  referenceStakeMinor: number;
  stakeTiltExponent: number;
}

export const DEFAULT_GLG_CONFIG: GlgConfig = {
  basePwinLadder: [
    [0.0, 0.2],
    [0.5, 0.35],
    [1.0, 0.45],
    [2.0, 0.48],
    [3.0, 0.5],
  ],
  pwinCeiling: 0.5,
  perAssetEdgeMargin: 0.05,
  givebackCushion: 0.9,
  givebackClampPwin: 0.15,
  referenceStakeMinor: 1000,
  stakeTiltExponent: 0.7,
};

/**
 * Piecewise-linear interpolation over sorted ladder points. Values outside
 * the range clamp to the nearest endpoint (no extrapolation).
 */
export function ladder(
  x: number,
  points: GlgConfig["basePwinLadder"],
): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * Treasury health = treasuryMinor / treasuryTargetMinor, clamped to [0, 3].
 * At health=0 we're broke (or in the red). At health=3 we're 3× above target
 * and there's no further reward on the ladder.
 */
export function treasuryHealth(
  treasuryMinor: number,
  treasuryTargetMinor: number,
): number {
  if (treasuryTargetMinor <= 0) return 3; // degenerate config → cap
  const raw = treasuryMinor / treasuryTargetMinor;
  return Math.max(0, Math.min(3, raw));
}

/**
 * Per-asset ceiling that guarantees the invariant `pWin < break-even`. For an
 * 85% payout: break-even = 100/185 = 0.5405, minus margin 0.05 → 0.4905. The
 * global ceiling (0.5) may override this upward, but if the asset's own edge
 * ceiling is *tighter* (lower payout → higher break-even → tighter safety
 * margin? no, higher payout → tighter break-even → tighter cap), we honor
 * the per-asset one.
 */
export function perAssetPwinCeiling(
  payoutPct: number,
  config: GlgConfig = DEFAULT_GLG_CONFIG,
): number {
  if (payoutPct <= 0) return config.pwinCeiling; // degenerate; use global cap
  const breakEven = 100 / (100 + payoutPct);
  return Math.max(0, breakEven - config.perAssetEdgeMargin);
}

/**
 * Decide the verdict. `rng` returns uniform [0, 1); inject a seeded RNG in
 * tests, `Math.random` in production.
 */
export function decideVerdictGLG(
  input: GlgInput,
  rng: () => number,
  config: GlgConfig = DEFAULT_GLG_CONFIG,
): GlgVerdict {
  if (input.isDemo) return "HONEST";

  const health = treasuryHealth(input.treasuryMinor, input.treasuryTargetMinor);
  let pWin = ladder(health, config.basePwinLadder);

  // Stake-tilt: higher stakes get a lower pWin so a single big win cannot
  // drain the treasury. Applied BEFORE the giveback clamp and ceiling so
  // those still bound the tilted result. Only bites when stake exceeds the
  // reference — small stakes get the ladder's baseline unchanged.
  if (
    config.stakeTiltExponent > 0 &&
    config.referenceStakeMinor > 0 &&
    input.tradeStakeMinor > config.referenceStakeMinor
  ) {
    const ratio = config.referenceStakeMinor / input.tradeStakeMinor;
    pWin *= Math.pow(ratio, config.stakeTiltExponent);
  }

  // Giveback protection: clamp when a WIN would push the treasury DOWN
  // through the cushion floor. Only fires when the treasury is currently at
  // or above the floor — a bootstrap-phase treasury (below the cushion) has
  // nothing to give back yet, and users should not be clamped for being
  // early adopters. Runs BEFORE the ceiling so the clamp is honored even if
  // ladder(health) is already above it.
  const wouldBePayout = Math.round(
    (input.tradeStakeMinor * input.tradePayoutPct) / 100,
  );
  const cushionFloor = input.treasuryTargetMinor * config.givebackCushion;
  const treasuryAfterWin = input.treasuryMinor - wouldBePayout;
  if (input.treasuryMinor >= cushionFloor && treasuryAfterWin < cushionFloor) {
    pWin = Math.min(pWin, config.givebackClampPwin);
  }

  // Global ceiling and per-asset edge ceiling. Take the STRICTER (lower) of
  // the two so the house edge invariant holds regardless of asset.
  const perAsset = perAssetPwinCeiling(input.tradePayoutPct, config);
  pWin = Math.min(pWin, config.pwinCeiling, perAsset);

  // Clamp to [0, 1] as a hard belt-and-braces guarantee.
  pWin = Math.max(0, Math.min(1, pWin));

  return rng() < pWin ? "WIN" : "LOSS";
}
