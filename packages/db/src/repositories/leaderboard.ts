import { prisma } from "../client";

export interface LeaderboardEntry {
  accountId: string;
  userId: string;
  /** Display name, or null (the caller masks the id as a fallback). */
  nickname: string | null;
  /** ISO country code for the flag, or null. */
  country: string | null;
  currency: string;
  /** Today's realized P/L in minor units of the account currency. */
  pnlMinor: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  /** The viewer's own standing; rank is 1-based, null when they have no ranked P/L today. */
  you: { rank: number | null; entry: LeaderboardEntry | null };
}

/**
 * Ranks LIVE accounts by realized P/L since `sinceMs` (start of the current
 * day), highest first. Realized P/L is the sum of settled trades' `pnl`
 * (WON/LOST/REFUNDED) that expired within the window. Bots are excluded
 * unless `includeBots` is set. The viewer's rank is computed across the full
 * ranked set, then the list is truncated to `limit`.
 */
export async function dailyLeaderboard(input: {
  sinceMs: number;
  viewerUserId: string;
  limit: number;
  includeBots: boolean;
}): Promise<LeaderboardResult> {
  const since = new Date(input.sinceMs);

  const grouped = await prisma.trade.groupBy({
    by: ["accountId"],
    where: {
      status: { in: ["WON", "LOST", "REFUNDED"] },
      expiryTs: { gte: since },
      account: {
        type: "LIVE",
        ...(input.includeBots ? {} : { user: { isBot: false } }),
      },
    },
    _sum: { pnl: true },
  });

  if (grouped.length === 0) {
    return { entries: [], you: { rank: null, entry: null } };
  }

  const accounts = await prisma.account.findMany({
    where: { id: { in: grouped.map((g) => g.accountId) } },
    select: {
      id: true,
      currency: true,
      userId: true,
      user: { select: { nickname: true, country: true } },
    },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const ranked: LeaderboardEntry[] = grouped
    .map((g) => {
      const a = byId.get(g.accountId);
      return {
        accountId: g.accountId,
        userId: a?.userId ?? "",
        nickname: a?.user.nickname ?? null,
        country: a?.user.country ?? null,
        currency: a?.currency ?? "INR",
        pnlMinor: g._sum.pnl ?? 0,
      };
    })
    .sort((a, b) => b.pnlMinor - a.pnlMinor || a.accountId.localeCompare(b.accountId));

  const yourIndex = ranked.findIndex((e) => e.userId === input.viewerUserId);
  const you = {
    rank: yourIndex >= 0 ? yourIndex + 1 : null,
    entry: yourIndex >= 0 ? ranked[yourIndex]! : null,
  };

  return { entries: ranked.slice(0, input.limit), you };
}
