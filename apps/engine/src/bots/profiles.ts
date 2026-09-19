import type { Direction } from "@asm/trading";
import type { Rng } from "@asm/pricing";

export type BotProfileName =
  | "MOMENTUM"
  | "CONTRARIAN"
  | "RANDOM"
  | "MARTINGALE"
  | "WHALE";

export interface BotProfile {
  name: BotProfileName;
  /** Mix share — must sum to 1 across all profiles. */
  weight: number;
  /** Mean inter-arrival in seconds (Poisson). */
  arrivalRateSec: number;
  /** Preferred trade duration in seconds. */
  durationSec: number;
  /** Stake in minor units. */
  baseStake: number;
  payoutPct: number;
}

export const PROFILES: BotProfile[] = [
  { name: "MOMENTUM",   weight: 0.30, arrivalRateSec: 8,  durationSec: 60,  baseStake: 10_000, payoutPct: 80 },
  { name: "CONTRARIAN", weight: 0.20, arrivalRateSec: 12, durationSec: 60,  baseStake: 8_000,  payoutPct: 80 },
  { name: "RANDOM",     weight: 0.25, arrivalRateSec: 15, durationSec: 120, baseStake: 5_000,  payoutPct: 80 },
  { name: "MARTINGALE", weight: 0.15, arrivalRateSec: 20, durationSec: 60,  baseStake: 5_000,  payoutPct: 80 },
  { name: "WHALE",      weight: 0.10, arrivalRateSec: 45, durationSec: 300, baseStake: 50_000, payoutPct: 80 },
];

// Validate weights sum to 1.
const WEIGHT_SUM = PROFILES.reduce((s, p) => s + p.weight, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`Profile weights must sum to 1, got ${WEIGHT_SUM}`);
}

export function pickProfile(rng: Rng): BotProfile {
  let r = rng.next();
  for (const profile of PROFILES) {
    r -= profile.weight;
    if (r <= 0) return profile;
  }
  return PROFILES[PROFILES.length - 1]!;
}

/** Direction logic per profile. */
export function chooseDirection(
  profile: BotProfile,
  recentMove: number,
  rng: Rng,
): Direction {
  switch (profile.name) {
    case "MOMENTUM":
      // Follow the recent move.
      return recentMove >= 0 ? "UP" : "DOWN";
    case "CONTRARIAN":
      // Bet against the recent move.
      return recentMove >= 0 ? "DOWN" : "UP";
    case "MARTINGALE":
    case "RANDOM":
    case "WHALE":
    default:
      // Coin flip.
      return rng.next() < 0.5 ? "UP" : "DOWN";
  }
}

/**
 * Stake logic per profile. Martingale doubles on a loss, capped at 10×.
 */
export function chooseStake(
  profile: BotProfile,
  lastLost: boolean,
  rng: Rng,
): number {
  if (profile.name === "MARTINGALE" && lastLost) {
    return Math.min(profile.baseStake * (1 + Math.floor(rng.next() * 3 + 1) * 2), profile.baseStake * 10);
  }
  // Small random jitter ±20% so all bots don't look identical.
  const jitter = 0.8 + rng.next() * 0.4;
  return Math.round(profile.baseStake * jitter);
}
