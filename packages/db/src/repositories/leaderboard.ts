import { prisma } from "../client";
import { isLeaderboardCountry, normalizeCountry } from "../country";
import { convertMinorBetween } from "./account";

export interface LeaderboardEntry {
  accountId: string;
  userId: string;
  /** Display name, or null (the caller masks the id as a fallback). */
  nickname: string | null;
  /** ISO alpha-2 country code for the flag, or null when unknown. */
  country: string | null;
  /** The board's display currency (every entry shares it). */
  currency: string;
  /** Today's realized P/L in minor units of `currency`. */
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
 * unless `includeBots` is set.
 *
 * Accounts hold INR or USD, so P/L is ranked on its INR value and reported in
 * `displayCurrency` — comparing raw minor units would put $1,000 below ₹2,000.
 * Only traders from LEADERBOARD_COUNTRIES are ranked; a viewer outside it (or
 * with no known country) still gets their own P/L back, with a null rank.
 * The viewer's rank is computed across the full ranked set, then the list is
 * truncated to `limit`.
 */
export async function dailyLeaderboard(input: {
  sinceMs: number;
  viewerUserId: string;
  limit: number;
  includeBots: boolean;
  displayCurrency: string;
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

  const all = grouped.map((g) => {
    const a = byId.get(g.accountId);
    const currency = a?.currency ?? "INR";
    const pnl = g._sum.pnl ?? 0;
    return {
      inrMinor: convertMinorBetween(pnl, currency, "INR"),
      entry: {
        accountId: g.accountId,
        userId: a?.userId ?? "",
        nickname: a?.user.nickname ?? null,
        country: normalizeCountry(a?.user.country),
        currency: input.displayCurrency,
        pnlMinor: convertMinorBetween(pnl, currency, input.displayCurrency),
      } satisfies LeaderboardEntry,
    };
  });

  const ranked: LeaderboardEntry[] = all
    .filter((r) => isLeaderboardCountry(r.entry.country))
    .sort((a, b) => b.inrMinor - a.inrMinor || a.entry.accountId.localeCompare(b.entry.accountId))
    .map((r) => r.entry);

  const yourIndex = ranked.findIndex((e) => e.userId === input.viewerUserId);
  const you =
    yourIndex >= 0
      ? { rank: yourIndex + 1, entry: ranked[yourIndex]! }
      : { rank: null, entry: all.find((r) => r.entry.userId === input.viewerUserId)?.entry ?? null };

  return { entries: ranked.slice(0, input.limit), you };
}

/** The board is shown in the viewer's LIVE account currency, INR when they have none. */
export async function leaderboardCurrencyFor(userId: string): Promise<string> {
  const live = await prisma.account.findUnique({
    where: { userId_type: { userId, type: "LIVE" } },
    select: { currency: true },
  });
  return live?.currency ?? "INR";
}
