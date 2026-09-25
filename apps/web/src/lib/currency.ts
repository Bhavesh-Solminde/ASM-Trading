/**
 * Client-safe mirror of the fixed FX rate in `@asm/db` (`USD_INR_RATE` /
 * `convertMinorBetween`). A client component can't import the db barrel — it
 * pulls in the Prisma client — so the rate lives here too, for the pre-convert
 * preview only. The server remains the source of truth; keep the two in step.
 */
export const USD_INR_RATE = 100;

/** Convert a minor-unit amount between INR and USD at the fixed rate. */
export function convertMinorBetween(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  if (from === "INR" && to === "USD") return Math.round(amount / USD_INR_RATE);
  if (from === "USD" && to === "INR") return amount * USD_INR_RATE;
  return amount;
}
