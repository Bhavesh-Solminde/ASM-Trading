export const AFFILIATE_LEVELS = [
  { level: 1, name: "Starter", minDeposits: 0, maxDeposits: 14 },
  { level: 2, name: "Advanced", minDeposits: 15, maxDeposits: 49 },
  { level: 3, name: "Professional", minDeposits: 50, maxDeposits: 99 },
  { level: 4, name: "Expert", minDeposits: 100, maxDeposits: 199 },
  { level: 5, name: "Master", minDeposits: 200, maxDeposits: 399 },
  { level: 6, name: "Guru", minDeposits: 400, maxDeposits: 699 },
  { level: 7, name: "Legend", minDeposits: 700, maxDeposits: null },
] as const;

export function levelForDeposits(count: number) {
  return AFFILIATE_LEVELS.findLast(({ minDeposits }) => count >= minDeposits) ?? AFFILIATE_LEVELS[0];
}
