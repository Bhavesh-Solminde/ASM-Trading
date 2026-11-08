import { dailyLeaderboard, demoLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { startOfDayMs } from "./day";

export function isDemoLeaderboard(): boolean {
  return process.env.LEADERBOARD_MODE === "demo";
}

/** Both the page and API use the same mode and clock. */
export async function loadLeaderboard(viewerUserId: string) {
  const currency = await leaderboardCurrencyFor(viewerUserId);
  const nowMs = Date.now();
  const result = isDemoLeaderboard()
    ? await demoLeaderboard({ nowMs, displayCurrency: currency })
    : await dailyLeaderboard({
        sinceMs: startOfDayMs(nowMs), viewerUserId, limit: 10,
        includeBots: false, displayCurrency: currency,
      });
  return { currency, result };
}
