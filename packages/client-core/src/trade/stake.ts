import { DURATIONS_SEC } from "@asm/trading";

/** Quick-pick stakes (major units), all at or above the currency's minimum. */
export function stakePresets(currency: string): readonly number[] {
  return currency === "INR" ? [100, 250, 500, 1000, 2500] : [1, 5, 10, 25, 100];
}

/** Opening stake for a fresh ticket: the INR minimum, or $10. */
export function defaultStake(currency: string): string {
  return currency === "INR" ? "100" : "10";
}

/** The largest investment the ticket accepts, in major units (₹10,00,000). */
export const MAX_STAKE_MAJOR = 1_000_000;

/** The investment field's next text: digits and "." only; `prev` when the typed amount would pass MAX_STAKE_MAJOR. */
export function nextStakeInput(raw: string, prev: string): string {
  const text = raw.replace(/[^0-9.]/g, "");
  return Number(text) > MAX_STAKE_MAJOR ? prev : text;
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

/**
 * The ticket's last stake and expiry live in localStorage, so a refresh — or
 * the remount when the chart enters/leaves fullscreen — keeps what the trader
 * set. Stakes are per currency (₹ and $ minimums differ).
 */
export function stakeStorageKey(currency: string): string {
  return `asm_ticket_stake:${currency}`;
}
export const EXPIRY_STORAGE_KEY = "asm_ticket_expiry";

export type TimeMode = "timer" | "time";

export interface SavedExpiry {
  durationSec: number;
  mode: TimeMode;
  /** The absolute expiry picked in TIME mode, or null in TIMER mode. */
  targetMs: number | null;
}

/** A stored stake text, or null when missing, malformed or not positive. */
export function parseSavedStake(raw: string | null): string | null {
  if (raw === null || !/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  return Number(raw) > 0 ? raw : null;
}

/**
 * A stored expiry, or null when missing or malformed. The duration must still
 * be one the engine offers; a TIME-mode target already in the past falls back
 * to TIMER mode with the same duration.
 */
export function parseSavedExpiry(raw: string | null, nowMs: number): SavedExpiry | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { durationSec, mode, targetMs } = v as Record<string, unknown>;
  if (typeof durationSec !== "number" || !(DURATIONS_SEC as readonly number[]).includes(durationSec)) return null;
  if (mode === "time" && typeof targetMs === "number" && targetMs > nowMs) {
    return { durationSec, mode: "time", targetMs };
  }
  return { durationSec, mode: "timer", targetMs: null };
}

/**
 * The investment field holds either an amount or a percentage of the
 * account's spendable balance (Quotex's "SWITCH"). The choice and the
 * percentage persist like the stake does.
 */
export type StakeUnit = "amount" | "percent";
export const STAKE_UNIT_STORAGE_KEY = "asm_ticket_stake_unit";
export const STAKE_PCT_STORAGE_KEY = "asm_ticket_stake_pct";
export const DEFAULT_STAKE_PCT = "10";
/** Quick-pick percentages; 100% is the phone sheet's "Max". */
export const PERCENT_PRESETS: readonly number[] = [1, 5, 10, 25, 50];

export function parseSavedUnit(raw: string | null): StakeUnit | null {
  return raw === "amount" || raw === "percent" ? raw : null;
}

/** A whole percentage 1–100 as text, or null. */
export function parseSavedPercent(raw: string | null): string | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? String(n) : null;
}

/** Percentage typed into the field, clamped to 1–100; 0 when empty or not a number. */
export function percentValue(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 0;
}

/**
 * The stake (minor units) a percentage of the balance comes to: rounded down
 * to whole rupees/dollars and never below the currency minimum (₹100 / $1),
 * however small the balance or the percentage. Null while the balance is
 * unknown or no percentage is set.
 */
export function stakeFromPercent(pct: number, balanceMinor: number | null, minStakeMinor: number): number | null {
  if (balanceMinor === null || pct <= 0) return null;
  const raw = Math.floor((Math.max(0, balanceMinor) * Math.min(100, pct)) / 100);
  return Math.max(minStakeMinor, raw - (raw % 100));
}
