/**
 * Client-safe mirror of the deposit bonus tiers in @asm/db (repositories/
 * deposit.ts — the server is what actually grants them). bonus.test.ts fails
 * if the two drift apart.
 */
export const BONUS_TIERS = [100, 100, 50, 50] as const;

/** Bonus % for a user's `n`th deposit (1-based); 0 past the last tier. */
export function bonusPercentForDeposit(n: number): number {
  return BONUS_TIERS[n - 1] ?? 0;
}

/** "1st", "2nd", "3rd", "4th" — the deposit numbers the offer talks about. */
export function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}
