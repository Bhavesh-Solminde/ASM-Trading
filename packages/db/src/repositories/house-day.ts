import { prisma } from "../client";
import type { HouseDay, TradeStatus } from "../../generated/prisma/client";

/** IST calendar day for an instant. IST is UTC+5:30, no DST. */
export function houseDateForInstant(instant: Date): Date {
  const istMs = instant.getTime() + 5.5 * 3_600_000;
  const ist = new Date(istMs);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()),
  );
}

export async function getHouseDay(date: Date): Promise<HouseDay | null> {
  return prisma.houseDay.findUnique({ where: { date } });
}

export async function listHouseDays(limit: number): Promise<HouseDay[]> {
  return prisma.houseDay.findMany({
    orderBy: { date: "desc" },
    take: Math.min(Math.max(limit, 1), 90),
  });
}

export async function upsertHouseDayTarget(input: {
  date: Date;
  targetProfitMinor: number;
}): Promise<HouseDay> {
  return prisma.houseDay.upsert({
    where: { date: input.date },
    create: {
      date: input.date,
      targetProfitMinor: input.targetProfitMinor,
    },
    update: {
      targetProfitMinor: input.targetProfitMinor,
    },
  });
}

/**
 * Increment daily counters after one settled non-DEMO trade. `userPnl` is
 * signed from the account holder's view; house realized flips the sign.
 * REFUNDED trades contribute zero. Best-effort at call sites — never rolls
 * a settled row back.
 */
export async function applySettlementToHouseDay(input: {
  date: Date;
  fallbackTargetMinor: number;
  userPnl: number;
  stake: number;
  outcome: TradeStatus;
}): Promise<HouseDay> {
  const houseDelta = input.outcome === "REFUNDED" ? 0 : -input.userPnl;
  const stakeDelta = input.outcome === "REFUNDED" ? 0 : input.stake;
  const payoutDelta =
    input.outcome === "WON" ? input.stake + Math.abs(houseDelta) : 0;

  return prisma.houseDay.upsert({
    where: { date: input.date },
    create: {
      date: input.date,
      targetProfitMinor: input.fallbackTargetMinor,
      realizedProfitMinor: houseDelta,
      totalStakesMinor: stakeDelta,
      totalPayoutsMinor: payoutDelta,
      tradesSettled: 1,
    },
    update: {
      realizedProfitMinor: { increment: houseDelta },
      totalStakesMinor: { increment: stakeDelta },
      totalPayoutsMinor: { increment: payoutDelta },
      tradesSettled: { increment: 1 },
    },
  });
}

/**
 * Consecutive most-recent LOST rows for one account, capped. Used by the
 * mercy floor. WON breaks the streak; REFUNDED is skipped.
 *
 * OPEN rows are treated as pre-decided losses when they carry a governor
 * verdict of "LOSS" — the trade will settle LOST unless the price feed
 * misbehaves. Counting them makes the streak accurate under rapid fire
 * (many 10s trades opened seconds apart, before any settle), so mercy
 * triggers on the user's next open instead of after they've quit.
 *
 * Returns both the count and the sum of stakes in the streak, in minor
 * units — the governor's mercy affordability cap needs both.
 */
export async function recentLossStreakStatsForAccount(
  accountId: string,
  cap = 10,
): Promise<{ count: number; totalStakeMinor: number }> {
  const rows = await prisma.trade.findMany({
    where: {
      accountId,
      OR: [
        { status: { in: ["WON", "LOST"] } },
        { status: "OPEN", verdict: "LOSS" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: cap,
    select: { status: true, verdict: true, stake: true },
  });
  let count = 0;
  let totalStakeMinor = 0;
  for (const row of rows) {
    const isLost =
      row.status === "LOST" ||
      (row.status === "OPEN" && row.verdict === "LOSS");
    if (isLost) {
      count++;
      totalStakeMinor += row.stake;
    } else {
      break;
    }
  }
  return { count, totalStakeMinor };
}
