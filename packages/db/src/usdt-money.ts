/**
 * USDT amounts are 6-decimal on-chain (TRC-20 USDT's own `decimals()`, verified
 * against the configured contract at engine startup — see chain-watcher/providers/tron.ts).
 * Account.realBalance/Transaction.amount are 32-bit Int columns storing 2-decimal
 * minor units (paise for INR, cents for USD) — a 6dp minor unit would overflow
 * Int32 at realistic balances and lose the sub-cent fraction the ledger has
 * nowhere to put. So a USDT deposit's reserved/credited amount
 * (Deposit.amountUsdtMinor) is 2dp ("USDT-cents"), exactly like every other
 * currency this app already handles, and the on-chain raw value is required to
 * be an exact multiple of 10_000 (10^6 / 10^2) to be representable at that
 * precision. This is integer-only arithmetic throughout — never a float.
 */

export const RAW_PER_MINOR = 10_000n;

/**
 * Converts a raw on-chain amount (6dp) to the app's 2dp minor unit. Returns
 * null — never rounds, truncates, or coerces — when the raw amount carries
 * genuine sub-cent on-chain precision (not an exact multiple of 10_000) or is
 * out of a safe integer range. A null here means "not representable at this
 * app's accounting precision"; callers must route that to manual review, not
 * silently drop the fraction.
 */
export function rawToNormalizedMinor(raw: bigint): number | null {
  if (raw <= 0n) return null;
  if (raw % RAW_PER_MINOR !== 0n) return null;
  const minor = raw / RAW_PER_MINOR;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** The exact inverse — used to compute the raw on-chain value a reserved 2dp amount corresponds to. */
export function normalizedMinorToRaw(minor: number): bigint {
  if (!Number.isInteger(minor) || minor <= 0) {
    throw new Error(`normalizedMinorToRaw: expected a positive integer, received ${minor}`);
  }
  return BigInt(minor) * RAW_PER_MINOR;
}
