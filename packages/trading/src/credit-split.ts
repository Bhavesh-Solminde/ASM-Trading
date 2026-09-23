/**
 * Splits a settlement credit between the real and bonus balances in the same
 * proportion the stake was drawn from them.
 *
 * Without this, staking bonus money and taking a refund — or a win — would
 * hand it back as withdrawable real money, and a deposit bonus becomes a
 * one-trade step around its turnover requirement.
 *
 * The bonus share ROUNDS UP (was floor pre-2026-09-23). Bonus is the sticky,
 * unwithdrawable balance; real is withdrawable. When a payout doesn't split
 * evenly, the leftover minor unit must not migrate from bonus to real — that
 * would be a slow drain of the house-locked balance into cashable money, and
 * with enough trades a bonus-only user could convert their entire stake to
 * withdrawable funds one minor unit at a time. Rounding up on bonus keeps
 * the leftover on the sticky side; real is shorted by at most one minor unit
 * per settlement, and the two parts always sum to the credit exactly.
 *
 * A `stakeFromBonus === 0` (pure real-money trade) short-circuits so no
 * rounding artefact ever puts a stray minor unit into bonus for a trade the
 * user paid entirely in real money — that would be an unfair grant, and the
 * detector would eventually flag it.
 */
export function splitSettlementCredit(
  credit: number,
  stake: number,
  stakeFromBonus: number,
): { toReal: number; toBonus: number } {
  if (!Number.isInteger(credit) || credit < 0) {
    throw new Error(`credit must be a non-negative integer, received ${credit}`);
  }
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${stake}`);
  }
  if (!Number.isInteger(stakeFromBonus) || stakeFromBonus < 0 || stakeFromBonus > stake) {
    throw new Error(`stakeFromBonus must be an integer in [0, stake], received ${stakeFromBonus}`);
  }
  if (stakeFromBonus === 0) return { toReal: credit, toBonus: 0 };
  if (credit === 0) return { toReal: 0, toBonus: 0 };
  const toBonus = Math.ceil((credit * stakeFromBonus) / stake);
  return { toReal: credit - toBonus, toBonus };
}
