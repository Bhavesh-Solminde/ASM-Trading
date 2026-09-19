/**
 * Splits a settlement credit between the real and bonus balances in the same
 * proportion the stake was drawn from them.
 *
 * Without this, staking bonus money and taking a refund — or a win — would
 * hand it back as withdrawable real money, and a deposit bonus becomes a
 * one-trade step around its turnover requirement.
 *
 * The bonus share floors, so rounding favours the real balance by at most one
 * minor unit and the two parts always sum to the credit exactly.
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
  const toBonus = Math.floor((credit * stakeFromBonus) / stake);
  return { toReal: credit - toBonus, toBonus };
}
