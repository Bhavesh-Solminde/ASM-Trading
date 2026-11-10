import { dailyLeaderboard, demoLeaderboard, leaderboardCurrencyFor } from "@asm/db";
import { startOfDayMs } from "@asm/client-core";

export function isDemoLeaderboard(): boolean {
  return process.env.LEADERBOARD_MODE === "demo";
}

/** Both the page and API use the same sources and clock. */
export async function loadLeaderboard(viewerUserId: string) {
  const demoAvailable = isDemoLeaderboard();
  const currency = await leaderboardCurrencyFor(viewerUserId);
  const nowMs = Date.now();
  const live = await dailyLeaderboard({
    sinceMs: startOfDayMs(nowMs), viewerUserId, limit: 10,
    includeBots: false, displayCurrency: currency,
  });

  if (!demoAvailable) return { currency, result: live };

  const demo = await demoLeaderboard({ nowMs, displayCurrency: currency });
  const entries = [...live.entries, ...demo.entries]
    .sort((a, b) => b.pnlMinor - a.pnlMinor || a.userId.localeCompare(b.userId));
  const viewerIndex = live.you.entry
    ? entries.findIndex((entry) => entry.accountId === live.you.entry?.accountId)
    : -1;

  return {
    currency,
    result: {
      entries,
      you: {
        rank: viewerIndex >= 0 ? viewerIndex + 1 : null,
        entry: live.you.entry,
      },
    },
  };
}
