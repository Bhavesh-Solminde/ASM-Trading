import type { Direction } from "@asm/trading";

export type BotProfile = "MOMENTUM" | "CONTRARIAN" | "RANDOM" | "MARTINGALE" | "WHALE";

export const PROFILE_MIX: { profile: BotProfile; share: number }[] = [
  { profile: "MOMENTUM", share: 0.35 },
  { profile: "CONTRARIAN", share: 0.25 },
  { profile: "RANDOM", share: 0.25 },
  { profile: "MARTINGALE", share: 0.1 },
  { profile: "WHALE", share: 0.05 },
];

export function pickProfile(u: number): BotProfile {
  let cumulative = 0;
  for (const entry of PROFILE_MIX) {
    cumulative += entry.share;
    if (u < cumulative) return entry.profile;
  }
  return "RANDOM";
}

export function chooseDirection(
  profile: BotProfile,
  recent: readonly number[],
  u: number,
): Direction {
  if (profile === "RANDOM" || recent.length < 2) {
    return u < 0.5 ? "UP" : "DOWN";
  }

  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const rising = last > first;

  switch (profile) {
    case "MOMENTUM":
      return rising ? "UP" : "DOWN";
    case "CONTRARIAN":
      return rising ? "DOWN" : "UP";
    case "MARTINGALE":
    case "WHALE":
      return u < 0.5 ? "UP" : "DOWN";
  }
}

export function chooseStake(profile: BotProfile, u1: number, u2: number): number {
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
  const base = Math.exp(Math.log(2_000) + 0.9 * z);
  const scale = profile === "WHALE" ? 25 : 1;
  const minor = Math.round(base * scale);
  return Math.max(100, Math.min(minor, 20_000_000));
}
