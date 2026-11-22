import { USD_INR_RATE } from "@asm/contracts";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../client";
import type { AffiliateSeriesPoint, AffiliateStatsRow, AffiliateTotals, AffiliateTraderRow, Bucket, Range } from "./affiliate-center";
import { affiliateDepositCtes } from "./affiliate-deposits";
import { istDay, istDayStart } from "./program-wallet";

type StatsOptions = { linkId?: string };
type TraderOptions = StatsOptions & { traderId?: string; page?: number; pageSize?: number };

const inr = (minor: Prisma.Sql, currency: Prisma.Sql) =>
  Prisma.sql`${minor}::numeric * CASE WHEN ${currency} IN ('USD', 'USDT') THEN ${USD_INR_RATE} ELSE 1 END`;

const inRange = (at: Prisma.Sql, range: Range) => Prisma.sql`${at} >= ${range.from} AND ${at} < ${range.to}`;

/** Each metric has its own business timestamp. Combining events prevents a
 * join between, for example, every deposit and every trade for one user. */
function eventsCtes(
  affiliateId: string,
  range: Range,
  options: StatsOptions & { traderId?: string } = {},
  mode: "series" | "totals" | "traders" | "grouped" = "totals",
) {
  const refLink = options.linkId ? Prisma.sql`AND u."referralLinkId" = ${options.linkId}` : Prisma.empty;
  const clickLink = options.linkId ? Prisma.sql`AND l.id = ${options.linkId}` : Prisma.empty;
  const trader = options.traderId ? Prisma.sql`AND starts_with(UPPER(LEFT(u.id, 8)), ${options.traderId.toUpperCase()})` : Prisma.empty;
  const ftd = Prisma.sql`
    SELECT d.at, r."userId", r."linkId", r.country, 'ftd' AS metric, d.minor
    FROM first_deposits d JOIN referrals r USING ("userId")
    WHERE d.status = 'COMPLETED' AND ${inRange(Prisma.sql`d.at`, range)}`;
  const tradeAt = Prisma.sql`COALESCE(t."closedAt", t."expiryTs")`;
  const paidAt = Prisma.sql`COALESCE(paid."createdAt", w."createdAt")`;
  return Prisma.sql`
    referrals AS (
      SELECT u.id AS "userId", u."createdAt", u."referralLinkId" AS "linkId", u.country
      FROM "User" u WHERE u."referredById" = ${affiliateId} AND NOT u."isBot" AND NOT u."legacySimulated"
        ${refLink} ${trader}
    ),
    ${affiliateDepositCtes},
    events AS (
      SELECT r."createdAt" AS at, r."userId", r."linkId", r.country, 'registration' AS metric, 1::numeric AS minor
      FROM referrals r WHERE ${inRange(Prisma.sql`r."createdAt"`, range)}
      UNION ALL ${ftd}
      ${mode === "traders" ? Prisma.empty : Prisma.sql`
        UNION ALL
        SELECT (d.day::timestamp - INTERVAL '5 hours 30 minutes') AS at, NULL, l.id, NULL, 'click', d.clicks
        FROM "AffiliateLink" l JOIN "AffiliateLinkDay" d ON d."linkId" = l.id
        WHERE l."affiliateId" = ${affiliateId}
          AND d.day >= ${istDay(range.from)}::date AND d.day < ${istDay(range.to)}::date ${clickLink}
      `}
      ${mode === "series" ? Prisma.empty : Prisma.sql`
        UNION ALL
        SELECT d.at, r."userId", r."linkId", r.country, 'deposit', d.minor
        FROM live_deposits d JOIN referrals r USING ("userId")
        WHERE d.status = 'COMPLETED' AND d.minor > 0 AND ${inRange(Prisma.sql`d.at`, range)}
        UNION ALL
        SELECT ${paidAt}, r."userId", r."linkId", r.country, 'withdrawal',
               ${inr(Prisma.sql`w.amount`, Prisma.sql`w.currency`)}
        FROM referrals r JOIN "Withdrawal" w ON w."userId" = r."userId" AND w.status = 'PAID'
        LEFT JOIN LATERAL (
          SELECT a."createdAt" FROM "AuditLog" a
          WHERE a."targetType" = 'Withdrawal' AND a."targetId" = w.id AND a.action = 'withdrawal.paid'
          ORDER BY a."createdAt" DESC LIMIT 1
        ) paid ON TRUE
        WHERE ${inRange(paidAt, range)}
        UNION ALL
        SELECT ${tradeAt}, r."userId", r."linkId", r.country, 'turnover',
               ${inr(Prisma.sql`(t.stake - t."stakeFromBonus")`, Prisma.sql`COALESCE(t.currency, a.currency)`)}
        FROM referrals r
        JOIN "Account" a ON a."userId" = r."userId" AND a.type = 'LIVE'
        JOIN "Trade" t ON t."accountId" = a.id
        WHERE t.status IN ('WON', 'LOST', 'CLOSED') AND t.stake > t."stakeFromBonus" AND ${inRange(tradeAt, range)}
        UNION ALL
        -- Only qualification earnings have a single referred trader. Pooled
        -- Revenue Share and adjustments stay in the all-affiliate totals.
        SELECT e."earnedAt", r."userId", r."linkId", r.country, 'earning',
               ${inr(Prisma.sql`e."amountMinor"`, Prisma.sql`e.currency`)}
        FROM "ProgramEarning" e
        LEFT JOIN "ReferralQualification" q ON q.id = e."qualificationId"
        LEFT JOIN referrals r ON r."userId" = q."referredUserId"
        WHERE e."beneficiaryUserId" = ${affiliateId} AND e.status <> 'VOID'
          AND ${inRange(Prisma.sql`e."earnedAt"`, range)}
          ${options.linkId || mode === "traders" ? Prisma.sql`AND r."userId" IS NOT NULL` : Prisma.empty}
      `}
      ${mode === "grouped" ? Prisma.sql`
        UNION ALL
        SELECT b."createdAt", r."userId", r."linkId", r.country, 'bonus',
               b.amount::numeric * CASE WHEN d.minor = d."creditMinor" THEN 1 ELSE ${USD_INR_RATE} END
        FROM live_deposits d JOIN referrals r USING ("userId")
        JOIN "Transaction" b ON b."accountId" = d."accountId" AND b.kind = 'BONUS_GRANT'
          AND b."refType" = 'Deposit' AND b."refId" = d.id AND b.amount > 0
        WHERE d.status = 'COMPLETED' AND d."creditMinor" IS NOT NULL AND ${inRange(Prisma.sql`b."createdAt"`, range)}
      ` : Prisma.empty}
    )`;
}

function countOf(metric: string) {
  return Prisma.sql`COUNT(*) FILTER (WHERE metric = ${metric})::int`;
}

function sumOf(metric: string) {
  return Prisma.sql`COALESCE(SUM(minor) FILTER (WHERE metric = ${metric}), 0)::bigint`;
}

const seriesColumns = Prisma.sql`
  ${sumOf("click")} AS clicks, ${countOf("registration")} AS registrations, ${countOf("ftd")} AS "ftdCount"`;

const totalColumns = Prisma.sql`
  ${seriesColumns},
  ${sumOf("ftd")} AS "ftdSumMinor",
  ${countOf("deposit")} AS "depositsCount", ${sumOf("deposit")} AS "depositsSumMinor",
  ${countOf("withdrawal")} AS "withdrawalsCount", ${sumOf("withdrawal")} AS "withdrawalsSumMinor",
  ${sumOf("turnover")} AS "turnoverMinor", ${sumOf("earning")} AS "earningsMinor"`;

type RawTotals = { [K in keyof AffiliateTotals]: AffiliateTotals[K] | bigint };

function numberTotals(row: RawTotals): AffiliateTotals {
  return {
    clicks: Number(row.clicks),
    registrations: Number(row.registrations),
    ftdCount: Number(row.ftdCount),
    ftdSumMinor: Number(row.ftdSumMinor),
    depositsCount: Number(row.depositsCount),
    depositsSumMinor: Number(row.depositsSumMinor),
    withdrawalsCount: Number(row.withdrawalsCount),
    withdrawalsSumMinor: Number(row.withdrawalsSumMinor),
    turnoverMinor: Number(row.turnoverMinor),
    earningsMinor: Number(row.earningsMinor),
  };
}

export async function getAffiliateTotals(affiliateId: string, range: Range, opts?: StatsOptions): Promise<AffiliateTotals> {
  const [row] = await prisma.$queryRaw<RawTotals[]>(Prisma.sql`
    WITH ${eventsCtes(affiliateId, range, opts)}
    SELECT ${totalColumns} FROM events`);
  return numberTotals(row!);
}

const bucketIntervals: Record<Bucket, string> = { day: "1 day", week: "1 week", month: "1 month" };
const istAt = Prisma.sql`at + INTERVAL '5 hours 30 minutes'`;

export async function getAffiliateSeries(affiliateId: string, range: Range, bucket: Bucket): Promise<AffiliateSeriesPoint[]> {
  if (range.from >= range.to) return [];
  type RawPoint = { day: string; clicks: bigint; registrations: number; ftdCount: number };
  const rows = await prisma.$queryRaw<RawPoint[]>(Prisma.sql`
    WITH ${eventsCtes(affiliateId, range, {}, "series")},
    buckets AS (
      SELECT generate_series(
        date_trunc(${bucket}, ${istDay(range.from)}::date::timestamp),
        date_trunc(${bucket}, ${istDay(new Date(range.to.getTime() - 1))}::date::timestamp),
        ${bucketIntervals[bucket]}::interval
      ) AS start
    )
    SELECT to_char(b.start, 'YYYY-MM-DD') AS day, ${seriesColumns}
    FROM buckets b LEFT JOIN events e ON date_trunc(${bucket}, ${istAt}) = b.start
    GROUP BY b.start ORDER BY b.start`);
  return rows.map(({ day, clicks, registrations, ftdCount }) => ({ start: istDayStart(day), clicks: Number(clicks), registrations, ftdCount }));
}

export async function getAffiliateStatsBy(
  affiliateId: string,
  by: "date" | "link" | "country",
  range: Range,
  opts?: StatsOptions,
): Promise<AffiliateStatsRow[]> {
  const expression = {
    date: Prisma.sql`to_char(${istAt}, 'YYYY-MM-DD')`,
    link: Prisma.sql`COALESCE("linkId", 'unattributed')`,
    country: Prisma.sql`COALESCE(NULLIF(TRIM(country), ''), 'Unknown')`,
  }[by];
  const label = by === "link"
    ? Prisma.sql`CASE WHEN l."isDefault" THEN 'Default link' ELSE COALESCE(l.comment, l.code, 'Unattributed') END`
    : Prisma.sql`m.key`;
  const join = by === "link"
    ? Prisma.sql`LEFT JOIN "AffiliateLink" l ON l.id = m.key AND l."affiliateId" = ${affiliateId}`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<(RawTotals & { key: string; label: string; bonusesSumMinor: bigint })[]>(Prisma.sql`
    WITH ${eventsCtes(affiliateId, range, opts, "grouped")},
    metrics AS (
      SELECT ${expression} AS key, ${totalColumns}, ${sumOf("bonus")} AS "bonusesSumMinor" FROM events GROUP BY 1
    )
    SELECT m.*, ${label} AS label FROM metrics m ${join} ORDER BY m.key ${by === "date" ? Prisma.sql`DESC` : Prisma.empty}`);
  return rows.map((row) => ({ key: row.key, label: row.label, ...numberTotals(row), bonusesSumMinor: Number(row.bonusesSumMinor) }));
}

type RawTrader = Omit<AffiliateTraderRow, "ftdMinor" | "depositsSumMinor" | "withdrawalsSumMinor" | "turnoverMinor" | "earningsMinor">
  & { ftdMinor: bigint; depositsSumMinor: bigint; withdrawalsSumMinor: bigint; turnoverMinor: bigint; earningsMinor: bigint };

export async function listAffiliateTraders(
  affiliateId: string,
  range: Range,
  opts: TraderOptions = {},
): Promise<{ rows: AffiliateTraderRow[]; total: number }> {
  const { page: requestedPage = 1, pageSize: requestedPageSize = 20 } = opts;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isSafeInteger(requestedPageSize) ? Math.min(100, Math.max(1, requestedPageSize)) : 20;
  const offset = Math.min((page - 1) * pageSize, Number.MAX_SAFE_INTEGER);
  const result = await prisma.$queryRaw<(({ traderId: null } | RawTrader) & { total: number })[]>(Prisma.sql`
    WITH ${eventsCtes(affiliateId, range, opts, "traders")},
    active AS (
      SELECT "userId" FROM events GROUP BY "userId"
    ),
    paged AS (
      SELECT r.* FROM active JOIN referrals r USING ("userId")
      ORDER BY r."createdAt" DESC, r."userId" ASC LIMIT ${pageSize} OFFSET ${offset}::bigint
    ),
    metrics AS (
      SELECT UPPER(LEFT(p."userId", 8)) AS "traderId", p."createdAt" AS "registeredAt", p."linkId", p.country,
             MIN(e.at) FILTER (WHERE metric = 'ftd') AS "ftdAt", ${sumOf("ftd")} AS "ftdMinor",
             ${countOf("deposit")} AS "depositsCount", ${sumOf("deposit")} AS "depositsSumMinor",
             ${sumOf("withdrawal")} AS "withdrawalsSumMinor", ${sumOf("turnover")} AS "turnoverMinor",
             ${sumOf("earning")} AS "earningsMinor", p."userId"
      FROM paged p JOIN events e USING ("userId") GROUP BY p."userId", p."createdAt", p."linkId", p.country
    )
    SELECT m."traderId", m."registeredAt", m."linkId", m.country, m."ftdAt", m."ftdMinor",
           m."depositsCount", m."depositsSumMinor", m."withdrawalsSumMinor", m."turnoverMinor", m."earningsMinor", tally.total
    FROM (SELECT COUNT(*)::int AS total FROM active) tally LEFT JOIN metrics m ON TRUE
    ORDER BY m."registeredAt" DESC, m."userId" ASC`);
  return {
    total: result[0]?.total ?? 0,
    rows: result.flatMap((row) => {
      if (row.traderId === null) return [];
      return [{
        traderId: row.traderId,
        registeredAt: row.registeredAt,
        linkId: row.linkId,
        country: row.country,
        ftdAt: row.ftdAt,
        ftdMinor: Number(row.ftdMinor),
        depositsCount: row.depositsCount,
        depositsSumMinor: Number(row.depositsSumMinor),
        withdrawalsSumMinor: Number(row.withdrawalsSumMinor),
        turnoverMinor: Number(row.turnoverMinor),
        earningsMinor: Number(row.earningsMinor),
      }];
    }),
  };
}
