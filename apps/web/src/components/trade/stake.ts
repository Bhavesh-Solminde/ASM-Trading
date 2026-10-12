/** Quick-pick stakes (major units), all at or above the currency's minimum. */
export function stakePresets(currency: string): readonly number[] {
  return currency === "INR" ? [100, 250, 500, 1000, 2500] : [1, 5, 10, 25, 100];
}

/** Opening stake for a fresh ticket: the INR minimum, or $10. */
export function defaultStake(currency: string): string {
  return currency === "INR" ? "100" : "10";
}

/** Stake in minor units from the ticket's text field; 0 when empty or not a positive number. */
export function stakeToMinor(stakeInput: string): number {
  const major = Number(stakeInput);
  return Number.isFinite(major) && major > 0 ? Math.round(major * 100) : 0;
}

/** Profit (not including the returned stake) a winning trade pays at `payoutPct`; null when unknown or no stake. */
export function profitForStake(stakeMinor: number, payoutPct: number | null): number | null {
  return payoutPct === null || stakeMinor === 0 ? null : Math.floor((stakeMinor * payoutPct) / 100);
}

/** The four one-tap expiries in the phone dock; every other offered duration lives behind "More". */
export const EXPIRY_CHIPS: readonly { readonly sec: number; readonly label: string }[] = [
  { sec: 30, label: "30s" },
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
  { sec: 900, label: "15m" },
];

/** A duration as a short label: 30 -> "30s", 120 -> "2m", 7200 -> "2h". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

/** Whether `sec` is one of the dock's one-tap expiry chips. */
export function isChipExpiry(sec: number): boolean {
  return EXPIRY_CHIPS.some((c) => c.sec === sec);
}

/** "1250" -> "1,250"; keeps any decimals the ticket already holds ("12.5" -> "12.5"). */
export function groupAmount(text: string): string {
  const [whole = "", frac] = text.split(".");
  const grouped = (whole === "" ? "0" : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}
