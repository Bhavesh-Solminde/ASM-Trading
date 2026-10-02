/**
 * Path styles — how the shown chart travels from entry to target.
 *
 * Three shapes so consecutive trades don't look identical:
 *   DIRECT     ramps smoothly toward the target from the start.
 *   OSCILLATE  wanders around entry for the first 60%, then converges.
 *   FEINT      drives AWAY from the target for the first 35%, then reverses
 *              and converges. Looks like a real market fake-out.
 *
 * `pathBias(style, t)` returns a scalar in roughly [-1, +1] that the engine's
 * per-tick magnet multiplies by the log-gap to `targetPrice`. A positive
 * value pulls toward the target; a negative value pushes away.
 *
 * `pickStyle(durationSec, verdict, rng)` samples one style per trade,
 * weighted so shorter trades (5s) always go DIRECT (no room for a feint),
 * medium trades favour OSCILLATE, and longer trades sprinkle in FEINT.
 *
 * All functions are pure. `rng` is a caller-injected uniform [0, 1) so
 * tests can pin the choice.
 */

import type { Verdict } from "./governor";

export type PathStyle = "DIRECT" | "OSCILLATE" | "FEINT";

/** Cubic ease-in-out: f(0)=0, f(1)=1, f'(0)=f'(1)=0. Bounded to [0, 1]. */
export function smoothstep(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/**
 * Signed pull toward the target.
 * @param style  one of DIRECT / OSCILLATE / FEINT
 * @param elapsedFrac  time elapsed / trade duration, in [0, 1]
 */
export function pathBias(style: PathStyle, elapsedFrac: number): number {
  const t = Math.max(0, Math.min(1, elapsedFrac));

  switch (style) {
    case "DIRECT":
      // Ramps in at 1.5× the elapsed fraction, capped at 1. Almost always
      // pulling; feels like a market that made its mind up.
      return Math.min(1, t * 1.5);

    case "OSCILLATE": {
      // 60% wander using a small-amplitude sine (four full cycles), then
      // convergence over the remaining 40% via smoothstep.
      if (t < 0.6) return 0.15 * Math.sin(t * 8 * Math.PI);
      return smoothstep((t - 0.6) / 0.4);
    }

    case "FEINT": {
      // First 35%: negative pull that grows from 0 to -1 (looks like the
      // wrong direction). Remaining 65%: positive pull from 0 to 1.
      if (t < 0.35) return -smoothstep(t / 0.35);
      return smoothstep((t - 0.35) / 0.65);
    }
  }
}

/**
 * Pick a style for a new trade.
 *
 * Rules:
 *   HONEST verdict never uses this — return DIRECT as a safe default.
 *   ≤ 5s   → DIRECT (no drama fits in 5 seconds).
 *   ≤ 20s  → 65% OSCILLATE, 35% DIRECT.
 *   > 20s  → 35% FEINT, 45% OSCILLATE, 20% DIRECT.
 *
 * Splits are chosen once so callers can pin them by fixing `rng`.
 */
export function pickStyle(
  durationSec: number,
  verdict: Verdict,
  rng: () => number,
): PathStyle {
  if (verdict === "HONEST") return "DIRECT";
  if (durationSec <= 5) return "DIRECT";

  const r = rng();
  if (durationSec <= 20) {
    return r < 0.65 ? "OSCILLATE" : "DIRECT";
  }
  if (r < 0.35) return "FEINT";
  if (r < 0.8) return "OSCILLATE";
  return "DIRECT";
}
