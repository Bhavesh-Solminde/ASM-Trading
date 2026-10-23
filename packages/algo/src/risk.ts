const MAX_STAKE_CAP = 100_000_00;
const MAX_DAILY_WIN_CAP = 1_000_000;
const TREASURY_STAKE_RATIO = 0.01;
const TREASURY_WIN_CAP_RATIO = 0.002;
const DAILY_LOSS_THRESHOLD = 0.02;

export function dynamicMaxStake(treasuryMinor: number): number {
  return Math.min(MAX_STAKE_CAP, Math.floor(treasuryMinor * TREASURY_STAKE_RATIO));
}

export function exposureCap(activeUsers: number): number {
  if (activeUsers < 20) return 500_000_00;
  if (activeUsers < 100) return 2_000_000_00;
  return 5_000_000_00;
}

export function dailyWinCap(treasuryMinor: number): number {
  return Math.min(MAX_DAILY_WIN_CAP, Math.floor(treasuryMinor * TREASURY_WIN_CAP_RATIO));
}

export function isDailyCircuitBroken(
  dailyHousePnlMinor: number,
  treasuryMinor: number,
): boolean {
  return dailyHousePnlMinor <= -(treasuryMinor * DAILY_LOSS_THRESHOLD);
}

export function emergencyModeConfig() {
  return { magnetMult: 5, spreadMult: 3, stakeMult: 0.5 } as const;
}

export function isVolCircuitBroken(
  recentMoves: number[],
  sigma: number,
): boolean {
  if (recentMoves.length === 0 || sigma <= 0) return false;
  const totalMove = Math.abs(recentMoves.reduce((s, m) => s + m, 0));
  return totalMove > 3 * sigma;
}

export function demoFillAdjustment(
  direction: "UP" | "DOWN",
  bid: number,
  ask: number,
): number {
  return (bid + ask) / 2;
}
