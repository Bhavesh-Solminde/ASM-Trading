/** Opening fees are 100 times the configured base spread. Existing trades retain their paid fee. */
export const CFD_SPREAD_FEE_MULTIPLIER = 100;
export function cfdSpreadFeeMinor(stakeMinor: number, baseSpreadBps: number): number {
  return Math.round(stakeMinor * baseSpreadBps * CFD_SPREAD_FEE_MULTIPLIER / 10000);
}
export function cfdSpreadFeePct(baseSpreadBps: number): number {
  return baseSpreadBps * CFD_SPREAD_FEE_MULTIPLIER / 100;
}
