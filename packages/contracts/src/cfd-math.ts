/** New CFD positions use fixed 100x leverage; legacy positions retain 1x. */
export const CFD_LEVERAGE = 100;
/** Maximum gross profit per position, relative to the invested stake. */
export const CFD_MAX_PROFIT_MULTIPLIER = 2;
export function cfdProfitMinor(direction: string, entry: number, exit: number, stake: number, leverage = 1): number {
  const move = direction === "UP" || direction === "LONG" ? exit - entry : entry - exit;
  return Math.min(stake * CFD_MAX_PROFIT_MULTIPLIER, Math.max(-stake, Math.round(move / entry * stake * leverage)));
}
export function cfdMaxProfitPrice(direction: string, entry: number, leverage = 1): number {
  return entry * (1 + (direction === "UP" || direction === "LONG" ? 1 : -1) * CFD_MAX_PROFIT_MULTIPLIER / leverage);
}
export function cfdLiquidationPrice(direction: string, entry: number, leverage: number): number {
  return entry * (1 + (direction === "UP" || direction === "LONG" ? -1 : 1) / leverage);
}
