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
 * Count consecutive most-recent LOST rows for one account, capped. Used by
 * the mercy floor. WON breaks the streak; OPEN and REFUNDED are skipped.
 */
export async function recentLossStreakForAccount(
  accountId: string,
  cap = 10,
): Promise<number> {
  const rows = await prisma.trade.findMany({
    where: { accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: cap,
    select: { status: true },
  });
  let streak = 0;
  for (const row of rows) {
    if (row.status === "LOST") streak++;
    else break;
  }
  return streak;
}
