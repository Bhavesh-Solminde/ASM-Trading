import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { groupAmountInput, minStakeMinor, stakeToMinor, type AmountOpts } from "@asm/client-core";

/** The contract's per-trade ceiling (`OpenTradeSchema.stake`), in minor units. */
export const MAX_STAKE_MINOR = 100_000_000;

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
  // 1,000,000 major units is the ceiling (MAX_STAKE_MINOR), so seven whole digits is all anyone can use.
  return { decimals: currency !== "INR", maxInt: 7 };
}

/** The stake text as shown: grouped thousands, "0" when empty, a trailing point kept while typing. */
export function stakeDisplay(text: string): string {
  return groupAmountInput(text);
}

export const DEFAULT_EXPIRY_SEC = 60;

/** A saved expiry the server still offers, else one minute (a stale or corrupted pref must not make every open fail). */
export function resolveExpiry(sec: number): number {
  return (TRADE_DURATIONS_SEC as readonly number[]).includes(sec) ? sec : DEFAULT_EXPIRY_SEC;
}
