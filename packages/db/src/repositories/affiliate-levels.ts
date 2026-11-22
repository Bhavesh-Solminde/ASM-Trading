import { AFFILIATE_LEVELS, levelForDeposits } from "@asm/contracts";
import { Prisma } from "../../generated/prisma/client";
import { prisma, type DbTransaction } from "../client";
import type { AffiliateLevelStatus, Range } from "./affiliate-center";
import { affiliateDepositCtes } from "./affiliate-deposits";
import { houseDateForInstant } from "./house-day";
import { defaultLevelRateValues } from "./program-settings";

const IST_OFFSET_MS = 330 * 60_000;

export function affiliateMonthBounds(at: Date) {
  const date = houseDateForInstant(at);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const monthDate = new Date(Date.UTC(year, month, 1));
  return {
    monthDate,
    before: new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS),
    start: new Date(monthDate.getTime() - IST_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - IST_OFFSET_MS),
  };
}

async function qualifyingDeposits(
  ids: string[],
  range: Range,
  client: Pick<DbTransaction, "$queryRaw">,
): Promise<Map<string, number>> {
  const rows = await client.$queryRaw<{ affiliateId: string; count: number }[]>(Prisma.sql`
    WITH referrals AS (
      SELECT id AS "userId", "referredById" AS "affiliateId" FROM "User"
      WHERE "referredById" = ANY(${ids}) AND NOT "isBot" AND NOT "legacySimulated"
    ), ${affiliateDepositCtes}
    SELECT r."affiliateId", COUNT(*)::int AS count
    FROM first_deposits d JOIN referrals r ON r."userId" = d."userId"
    JOIN LATERAL (
      SELECT value FROM "ProgramSetting" s
      WHERE s.key = 'MIN_QUALIFYING_DEPOSIT_INR_MINOR' AND s."effectiveFrom" <= d.at
      ORDER BY s."effectiveFrom" DESC, s."createdAt" DESC, s.id DESC LIMIT 1
    ) minimum ON d.minor >= minimum.value
    WHERE d.status = 'COMPLETED' AND d.at >= ${range.from} AND d.at < ${range.to}
      AND NOT EXISTS (
        SELECT 1 FROM "FraudFlag" f WHERE f.kind = 'SELF_REFERRAL' AND f.status = 'CONFIRMED'
          AND (f."userId" = d."userId" OR f."linkedUserIds" @> ARRAY[d."userId"])
      )
    GROUP BY r."affiliateId"`);
  return new Map(rows.map(({ affiliateId, count }) => [affiliateId, count]));
}

/** Once set, a month keeps its level even if a previous credit is later reversed or flagged. */
export async function getAffiliateMonthLevels(ids: string[], at: Date, client: DbTransaction = prisma) {
  const { monthDate, before, start } = affiliateMonthBounds(at);
  const where = { affiliateId: { in: ids }, month: monthDate };
  const stored = await client.affiliateMonthLevel.findMany({ where });
  const levels = new Map(stored.map((row) => [row.affiliateId, row]));
  const missing = ids.filter((id) => !levels.has(id)).sort();
  if (missing.length === 0) return levels;

  const counts = await qualifyingDeposits(missing, { from: before, to: start }, client);
  await client.affiliateMonthLevel.createMany({
    data: missing.map((affiliateId) => {
      const count = counts.get(affiliateId) ?? 0;
      return { affiliateId, month: monthDate, level: levelForDeposits(count).level, qualifyingDeposits: count };
    }),
    skipDuplicates: true,
  });
  // When a concurrent money/summary read wins, use its saved snapshot.
  const inserted = await client.affiliateMonthLevel.findMany({ where: { ...where, affiliateId: { in: missing } } });
  for (const row of inserted) levels.set(row.affiliateId, row);
  return levels;
}

export async function getAffiliateLevelStatus(affiliateId: string, now = new Date()): Promise<AffiliateLevelStatus> {
  const { start, end } = affiliateMonthBounds(now);
  const [frozen, counts] = await Promise.all([
    getAffiliateMonthLevels([affiliateId], now),
    qualifyingDeposits([affiliateId], { from: start, to: new Date(Math.min(end.getTime(), now.getTime() + 1)) }, prisma),
  ]);
  const monthQualifyingDeposits = counts.get(affiliateId) ?? 0;
  const current = AFFILIATE_LEVELS[(frozen.get(affiliateId)?.level ?? 1) - 1]!;
  const next = levelForDeposits(monthQualifyingDeposits);
  const higher = AFFILIATE_LEVELS.find(({ level }) => level === current.level + 1);
  return {
    current: { level: current.level, name: current.name },
    next: { level: next.level, name: next.name },
    monthQualifyingDeposits,
    toKeep: Math.max(0, current.minDeposits - monthQualifyingDeposits),
    toNextLevel: higher ? Math.max(0, higher.minDeposits - monthQualifyingDeposits) : null,
  };
}

export const levelTermsOrder = [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }] as const;

export async function affiliateLevelTermsAt(at: Date, client: DbTransaction = prisma) {
  const rows = await client.affiliateLevelTerms.findMany({
    where: { effectiveFrom: { lte: at } },
    orderBy: [{ level: "asc" }, ...levelTermsOrder],
    distinct: ["level"],
  });
  return new Map(rows.map((row) => [row.level, row]));
}

async function listCurrentLevelTerms(at: Date) {
  const [terms, defaults] = await Promise.all([affiliateLevelTermsAt(at), defaultLevelRateValues(at)]);
  return AFFILIATE_LEVELS.map((level) => {
    const row = terms.get(level.level);
    return {
      ...level,
      revenueShareBps: row?.revenueShareBps ?? defaults.revenueShareBps,
      depositRewardBps: row?.depositRewardBps ?? defaults.depositRewardBps,
    };
  });
}

export async function listLevelTermsForAdmin(at = new Date()) {
  const [current, scheduled] = await Promise.all([
    listCurrentLevelTerms(at),
    prisma.affiliateLevelTerms.findMany({
      where: { effectiveFrom: { gt: at } },
      // A new version for the same midnight supersedes the previously scheduled rates.
      orderBy: [{ level: "asc" }, { effectiveFrom: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      distinct: ["level"],
      select: { level: true, revenueShareBps: true, depositRewardBps: true, effectiveFrom: true },
    }),
  ]);
  const nextByLevel = new Map(scheduled.map(({ level, ...rates }) => [level, rates]));
  return current.map((level) => ({ ...level, scheduled: nextByLevel.get(level.level) ?? null }));
}

export async function listLevelTerms(at = new Date()) {
  return (await listCurrentLevelTerms(at)).map(({ level, name, minDeposits, maxDeposits, revenueShareBps }) =>
    ({ level, name, minDeposits, maxDeposits, revenueShareBps }),
  );
}
