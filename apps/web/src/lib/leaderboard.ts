import { dailyLeaderboard, demoLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { startOfDayMs } from "@asm/client-core";

/** Keep simulated results outside the live standings and viewer rank. */
export async function loadLeaderboard(viewerUserId: string) {
  const currency = await leaderboardCurrencyFor(viewerUserId);
  const nowMs = Date.now();
  const result = await dailyLeaderboard({
    sinceMs: startOfDayMs(nowMs), viewerUserId, limit: 10,
    includeBots: false, displayCurrency: currency,
  });

  const demo = process.env.LEADERBOARD_MODE === "demo"
    ? demoLeaderboard({ nowMs, displayCurrency: currency })
    : null;
  return { result, demo };
}
