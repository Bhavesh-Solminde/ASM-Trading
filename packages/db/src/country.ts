/**
 * Countries the public leaderboard shows: South Asia plus the Gulf states with
 * large Hindi/Urdu-speaking communities. Anyone outside this set (or with no
 * known country) still trades normally, they just aren't ranked publicly.
 */
export const LEADERBOARD_COUNTRIES: ReadonlySet<string> = new Set([
  "IN", "PK", "BD", "NP", "LK",
  "AE", "SA", "QA", "KW", "OM", "BH",
]);

/**
 * English names users type into KYC, mapped to ISO-3166 alpha-2. Covers the
 * leaderboard region plus the countries the bots used to claim, so an
 * out-of-region name is recognised (and excluded) rather than left unknown.
 */
const NAME_TO_CODE: Record<string, string> = {
  india: "IN",
  bharat: "IN",
  pakistan: "PK",
  bangladesh: "BD",
  nepal: "NP",
  "sri lanka": "LK",
  srilanka: "LK",
  "united arab emirates": "AE",
  uae: "AE",
  emirates: "AE",
  dubai: "AE",
  "saudi arabia": "SA",
  ksa: "SA",
  qatar: "QA",
  kuwait: "KW",
  oman: "OM",
  bahrain: "BH",
  nigeria: "NG",
  indonesia: "ID",
  philippines: "PH",
  egypt: "EG",
  malaysia: "MY",
};

/**
 * ISO alpha-2 code from a stored country, which is either a code (bots, IP
 * geolocation) or a free-text name (KYC form). Null when it can't be read.
 */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return NAME_TO_CODE[v.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ")] ?? null;
}

export function isLeaderboardCountry(raw: string | null | undefined): boolean {
  const code = normalizeCountry(raw);
  return code !== null && LEADERBOARD_COUNTRIES.has(code);
}
