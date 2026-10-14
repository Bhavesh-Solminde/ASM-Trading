import { OpenTradeSchema, TRADE_DURATIONS_SEC } from "@asm/contracts";
import { applyKey, defaultStake, formatMinor, groupAmountInput, minStakeMinor, stakeToMinor, type AmountOpts } from "@asm/client-core";

/** The contract's per-trade ceiling, in minor units, read from `OpenTradeSchema.stake` so the two cannot drift. */
export const MAX_STAKE_MINOR: number = OpenTradeSchema.shape.stake.maxValue ?? Number.MAX_SAFE_INTEGER;

export type StakeCheck = { ok: true; minor: number } | { ok: false; reason: "empty" | "min" | "max" | "balance" };

/**
 * Whether the typed stake can be sent. `available` is the account's real + bonus balance in minor units: the
 * server draws a stake from real first, then bonus, and refuses only when the two together fall short.
 */
export function validateStake(input: string, currency: string, available: number): StakeCheck {
  if (!input.trim()) return { ok: false, reason: "empty" };
  const minor = stakeToMinor(input);
  if (!Number.isFinite(minor) || minor <= 0) return { ok: false, reason: "empty" };
  if (minor < minStakeMinor(currency)) return { ok: false, reason: "min" };
  if (minor > MAX_STAKE_MINOR) return { ok: false, reason: "max" };
  if (minor > (Number.isFinite(available) ? available : 0)) return { ok: false, reason: "balance" };
  return { ok: true, minor };
}

/** Whole rupees on INR; two decimals on every other currency. */
export function stakeAmountOpts(currency: string): AmountOpts {
  // No more whole digits than the ceiling (MAX_STAKE_MINOR) has.
  return { decimals: currency !== "INR", maxInt: String(Math.floor(MAX_STAKE_MINOR / 100)).length };
}

/** The stake text as shown: grouped thousands, "0" when empty, a trailing point kept while typing. */
export function stakeDisplay(text: string): string {
  return groupAmountInput(text);
}

/**
 * The stake tile's text: always the amount with its currency, valid or not (the validation message under it says
 * what is wrong with an over-max or over-balance stake), and a dash once the stake is cleared.
 */
export function stakeTileLabel(text: string, currency: string): string {
  return text.trim() === "" ? "—" : formatMinor(stakeToMinor(text), currency);
}

export const DEFAULT_EXPIRY_SEC = 60;

/** A saved expiry the server still offers, else one minute (a stale or corrupted pref must not make every open fail). */
export function resolveExpiry(sec: number): number {
  return (TRADE_DURATIONS_SEC as readonly number[]).includes(sec) ? sec : DEFAULT_EXPIRY_SEC;
}

/** The saved stake for a currency, else that currency's default. A cleared stake ("") is the user's choice and is kept. */
export function stakeFor(byCurrency: Readonly<Record<string, string>>, currency: string): string {
  return byCurrency[currency] ?? defaultStake(currency);
}

export function withStake(byCurrency: Readonly<Record<string, string>>, currency: string, stake: string): Record<string, string> {
  return { ...byCurrency, [currency]: stake };
}

/**
 * The per-currency stake map after one keypad press, built on the map it is given. The caller passes the LATEST
 * saved map (from the store, not a render-time copy), so two presses landing before a re-render both count.
 */
export function stakeAfterKey(
  byCurrency: Readonly<Record<string, string>>,
  currency: string,
  key: string,
  opts: AmountOpts,
): Record<string, string> {
  return withStake(byCurrency, currency, applyKey(stakeFor(byCurrency, currency), key, opts));
}
