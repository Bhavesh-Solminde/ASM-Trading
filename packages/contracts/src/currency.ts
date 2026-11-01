/**
 * The platform's ONE fixed USD/INR rate: ₹110 = $1 (owner decision 2026-10-31).
 * Every real-money conversion imports this constant — the currency switch, the
 * deposit USD figure, USDT deposits credited to an INR account, derived
 * withdrawal limits, leaderboard display, and the client previews. Both
 * currencies carry two minor digits (paise / cents), so the same factor relates
 * their minor units: `INR_minor = USD_minor × USD_INR_RATE`.
 *
 * It is a fixed rate by design: it does not follow live market FX, and changing
 * it re-prices future conversions only (balances already held are not touched).
 * This package is pure (zod only), so the db, web, engine and any client can
 * import it without pulling server code.
 */
export const USD_INR_RATE = 110;

/**
 * Convert a minor-unit amount between INR and USD at the fixed rate. INR→USD
 * rounds with `Math.round` (half toward +infinity, so −1.5 → −1); the SQL that
 * rewrites trade rows in the db package mirrors that with `FLOOR(x + 0.5)`.
 */
export function convertMinorBetween(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  if (from === "INR" && to === "USD") return Math.round(amount / USD_INR_RATE);
  if (from === "USD" && to === "INR") return amount * USD_INR_RATE;
  // Unknown pair: no conversion (callers validate currencies first).
  return amount;
}
