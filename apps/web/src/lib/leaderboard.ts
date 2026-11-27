import { dailyLeaderboard, demoLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { startOfDayMs } from "@asm/client-core";

export function isDemoLeaderboard(): boolean {
  return process.env.LEADERBOARD_MODE === "demo";
}

/** Both the page and API use the same sources and clock. */
export async function loadLeaderboard(viewerUserId: string) {
  const currency = await leaderboardCurrencyFor(viewerUserId);
  const nowMs = Date.now();
  const demo = isDemoLeaderboard() ? await demoLeaderboard({ nowMs, displayCurrency: "INR" }) : null;
  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(nowMs), viewerUserId, limit: 10,
    includeBots: false, displayCurrency: currency,
    ...(demo && { demoEntriesInInr: demo.entries }),
  });
  return { currency, result };
}
