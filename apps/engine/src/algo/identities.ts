import type { Rng } from "@asm/pricing";

// A spread of display names and ISO country codes so the leaderboard reads like
// a real venue. Deterministic given the crowd's seeded Rng.
const NAMES = [
  "YT", "KHAN", "RATHORE 7773", "TMT MEMBER", "JJ_TRADER", "Milan Jain", "XSURESHOT",
  "Stone shooter", "SSPTRADERS", "AlphaWolf", "Priya K", "Rohan_FX", "DeltaOne", "Nova",
  "Aarav", "Zenith", "MoonRaker", "Ibrahim", "GoldenBull", "Sneha", "Vikram S", "QuantEdge",
  "Fahad", "RiverPhoenix", "Tanvir", "BlueChip", "Aditya", "Simran", "NightHawk", "Meera",
];

// Only the leaderboard's region (LEADERBOARD_COUNTRIES in @asm/db), weighted
// so India dominates the board the way it dominates real traffic.
export const BOT_COUNTRIES = [
  "IN", "IN", "IN", "IN", "IN", "IN", "IN", "IN",
  "PK", "PK", "BD", "BD", "AE", "AE", "NP", "LK", "SA", "QA", "KW", "OM", "BH",
];

export function botIdentity(rng: Rng, index: number): { nickname: string; country: string } {
  const base = NAMES[index % NAMES.length]!;
  // Append a short suffix past the first pass so names stay distinct across many bots.
  const suffix = index >= NAMES.length ? ` ${Math.floor(index / NAMES.length) + 1}` : "";
  const country = BOT_COUNTRIES[Math.floor(rng.next() * BOT_COUNTRIES.length)]!;
  return { nickname: `${base}${suffix}`, country };
}
