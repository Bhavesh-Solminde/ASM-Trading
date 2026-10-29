/** Opening fees are 100 times the configured base spread. Existing trades retain their paid fee. */
export const CFD_SPREAD_FEE_MULTIPLIER = 100;
/** No opening fee exceeds ₹50 (minor units; accounts are INR), however large the stake. */
export const CFD_SPREAD_FEE_CAP_MINOR = 5000;
export function cfdSpreadFeeMinor(stakeMinor: number, baseSpreadBps: number): number {
  return Math.min(CFD_SPREAD_FEE_CAP_MINOR, Math.round(stakeMinor * baseSpreadBps * CFD_SPREAD_FEE_MULTIPLIER / 10000));
}
export function cfdSpreadFeePct(baseSpreadBps: number): number {
  return baseSpreadBps * CFD_SPREAD_FEE_MULTIPLIER / 100;
}
