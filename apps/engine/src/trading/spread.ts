const LOCKOUT_SEC = 10;
const EARLY_CLOSE_WINDOW_SEC = 60;

export function computeSpread(
  midPrice: number,
  spreadBps: number,
  userMultiplier: number,
): { bid: number; ask: number } {
  const halfSpread = midPrice * (spreadBps / 10000 / 2) * userMultiplier;
  return {
    bid: midPrice - halfSpread,
    ask: midPrice + halfSpread,
  };
}

export function fillPrice(
  direction: "UP" | "DOWN",
  bid: number,
  ask: number,
  fillSkew: number,
): number {
  const spread = ask - bid;
  if (direction === "UP") {
    return ask + spread * fillSkew;
  }
  return bid - spread * fillSkew;
}

export function userSpreadMultiplier(
  userDailyPnl: number,
  dailyWinCap: number,
): number {
  if (userDailyPnl >= dailyWinCap) return 3;
  return 1;
}

export function userFillSkew(
  userDailyPnl: number,
  dailyWinCap: number,
): number {
  if (userDailyPnl >= dailyWinCap) return 0.5;
  return 0;
}

export function earlyCloseMultiplier(tradeAgeSec: number): number {
  if (tradeAgeSec < LOCKOUT_SEC) return Infinity;
  if (tradeAgeSec < EARLY_CLOSE_WINDOW_SEC) return 2;
  return 1;
}

export function isHardBlocked(
  userDailyPnl: number,
  dailyWinCap: number,
): boolean {
  return userDailyPnl >= dailyWinCap * 2;
}
