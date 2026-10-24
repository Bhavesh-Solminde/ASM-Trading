/** New CFD positions use fixed 100x leverage; legacy positions retain 1x. */
export const CFD_LEVERAGE = 100;
export function cfdProfitMinor(direction: string, entry: number, exit: number, stake: number, leverage = 1): number {
  const move = direction === "UP" || direction === "LONG" ? exit - entry : entry - exit;
  return Math.max(-stake, Math.round(move / entry * stake * leverage));
}
export function cfdLiquidationPrice(direction: string, entry: number, leverage: number): number {
  return entry * (1 + (direction === "UP" || direction === "LONG" ? -1 : 1) / leverage);
}
