/**
 * Client-safe re-export of the platform's one fixed FX rate (₹110 = $1) and its
 * converter, which live in `@asm/contracts` — a pure package, so a client
 * component can import them without pulling in the Prisma client the `@asm/db`
 * barrel builds. There is deliberately no second copy of the rate here.
 */
export { USD_INR_RATE, convertMinorBetween } from "@asm/contracts";

/**
 * Smallest stake a trade may open with, in the account's minor units: ₹100 on
 * an INR account, one whole unit ($1) on any other. The trades route enforces
 * it; the ticket mirrors it for an inline error before the request.
 */
export function minStakeMinor(currency: string): number {
  return currency === "INR" ? 100_00 : 1_00;
}
