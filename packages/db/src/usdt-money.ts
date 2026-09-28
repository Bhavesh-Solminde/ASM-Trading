/**
 * On-chain USDT amounts are integers in the token's own base units, whose
 * scale is the token contract's `decimals()` — 6 for TRON (TRC-20) USDT, 18
 * for BNB Smart Chain (BEP-20) USDT. The engine verifies the configured
 * decimals against the contract at startup; this module never assumes one.
 *
 * Account.realBalance/Transaction.amount are 32-bit Int columns storing
 * 2-decimal minor units (paise for INR, cents for USD) — a 6dp or 18dp minor
 * unit would overflow Int32 at realistic balances and lose the sub-cent
 * fraction the ledger has nowhere to put. So a USDT deposit's
 * reserved/credited amount (Deposit.amountUsdtMinor) is 2dp ("USDT-cents"),
 * exactly like every other currency this app already handles, and the
 * on-chain raw value is required to be an exact multiple of
 * 10^(decimals - 2) to be representable at that precision. This is
 * integer-only arithmetic throughout — never a float.
 */

/** Raw base units per 2dp minor unit: 10^(decimals - 2). Throws unless decimals is an integer >= 2. */
export function rawPerMinor(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 2) {
    throw new Error(`rawPerMinor: expected an integer >= 2 token decimals, received ${decimals}`);
  }
  return 10n ** BigInt(decimals - 2);
}

/**
 * Converts a raw on-chain amount (`decimals` dp) to the app's 2dp minor unit.
 * Returns null — never rounds, truncates, or coerces — when the raw amount
 * carries genuine sub-cent on-chain precision (not an exact multiple of
 * 10^(decimals-2)), is not positive, or is out of a safe integer range. A null
 * here means "not representable at this app's accounting precision"; callers
 * must route that to manual review, not silently drop the fraction.
 */
export function rawToNormalizedMinor(raw: bigint, decimals: number): number | null {
  const per = rawPerMinor(decimals);
  if (raw <= 0n) return null;
  if (raw % per !== 0n) return null;
  const minor = raw / per;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** The exact inverse — the raw on-chain value (`decimals` dp) a reserved 2dp amount corresponds to. */
export function normalizedMinorToRaw(minor: number, decimals: number): bigint {
  const per = rawPerMinor(decimals);
  if (!Number.isInteger(minor) || minor <= 0) {
    throw new Error(`normalizedMinorToRaw: expected a positive integer, received ${minor}`);
  }
  return BigInt(minor) * per;
}
