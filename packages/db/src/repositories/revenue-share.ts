import { convertMinorBetween } from "@asm/contracts";
import { prisma, type DbTransaction } from "../client";
import { getAffiliateRateAt } from "./affiliate-rate";
import { addIstDays, earningHoldReasons, istDayStart, makeEarningAvailable } from "./program-wallet";

// §9–§10 Revenue Share, step 1 of the daily close (Affiliate Program spec).

/** One affiliate-day: losses carry forward, never claw back; share rounds down. */
export function revenueShareOf(netMinor: number, carryInMinor: number, rateBps: number) {
  const total = netMinor + carryInMinor;
  const eligibleMinor = Math.max(0, total);
  return { eligibleMinor, shareMinor: Math.floor((eligibleMinor * rateBps) / 10_000), carryOutMinor: Math.min(0, total) };
}

/**
 * Company gain in INR paise per affiliate for IST day `day`, real-money part
 * only: per trade −pnl × (stake − stakeFromBonus) / stake, truncated toward
 * zero in the trade currency, then converted with the single platform rate.
 * Trades of QUALIFIED referrals of non-legacy affiliates, settled (WON / LOST /
 * CLOSED, LIVE) in the day and at/after qualifiedAt; referred users with an
 * OPEN/CONFIRMED SELF_REFERRAL flag, bots and legacy accounts are excluded.
 */
export async function revenueShareNetByAffiliate(
  tx: Pick<DbTransaction, "$queryRaw">,
  day: string,
): Promise<Map<string, { netMinor: number; tradeCount: number }>> {
  const start = istDayStart(day);
  const end = istDayStart(addIstDays(day, 1));
  // numeric + div(): exact and truncated toward zero, no bigint overflow on huge positions.
  const rows = await tx.$queryRaw<{ affiliateId: string; currency: string; net: string; n: number }[]>`
    SELECT q."inviterId" AS "affiliateId", COALESCE(t.currency, a.currency) AS currency,
           SUM(div((-t.pnl)::numeric * (t.stake - t."stakeFromBonus")::numeric, t.stake::numeric))::text AS net, COUNT(*)::int AS n
    FROM "Trade" t
    JOIN "Account" a ON a.id = t."accountId" AND a.type = 'LIVE'
    JOIN "User" u ON u.id = a."userId" AND u."isBot" = false AND u."legacySimulated" = false
    JOIN "ReferralQualification" q ON q."referredUserId" = u.id AND q.status = 'QUALIFIED'
    JOIN "User" inv ON inv.id = q."inviterId" AND inv.role = 'AFFILIATE' AND inv."legacySimulated" = false
    WHERE t.status::text IN ('WON', 'LOST', 'CLOSED')
      AND t.stake > 0
      AND COALESCE(t."closedAt", t."expiryTs") >= ${start}
      AND COALESCE(t."closedAt", t."expiryTs") < ${end}
      AND COALESCE(t."closedAt", t."expiryTs") >= q."qualifiedAt"
      AND NOT EXISTS (
        SELECT 1 FROM "FraudFlag" f
        WHERE f.kind = 'SELF_REFERRAL' AND f.status IN ('OPEN', 'CONFIRMED')
          AND (f."userId" = u.id OR u.id = ANY(f."linkedUserIds")))
    GROUP BY 1, 2`;
  const out = new Map<string, { netMinor: number; tradeCount: number }>();
  for (const r of rows) {
    const cur = out.get(r.affiliateId) ?? { netMinor: 0, tradeCount: 0 };
    cur.netMinor += convertMinorBetween(Number(r.net), r.currency === "USDT" ? "USD" : r.currency, "INR");
    cur.tradeCount += r.n;
    out.set(r.affiliateId, cur);
  }
  return out;
}

/** Per-transaction lock that serialises every close step of one IST day across processes. */
export const lockProgramDay = (tx: Pick<DbTransaction, "$queryRaw">, day: string) =>
  tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`program-day-close:${day}`}))`;

/**
 * Writes the RevenueShareDay rows for `day` and, for a positive share, a
 * REVENUE_SHARE earning that is AVAILABLE at once (or HELD). One small
 * transaction per affiliate under the day lock; an affiliate whose row already
 * exists (an earlier or concurrent run) is skipped, so re-running is safe.
 * Every earlier day must already be closed (carry-in). Returns the affiliate count.
 */
export async function computeRevenueShareDay(day: string): Promise<number> {
  const close = istDayStart(addIstDays(day, 1));
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const nets = await revenueShareNetByAffiliate(prisma, day);
  const affiliates = [...nets.keys()].sort();
  for (const affiliateId of affiliates) {
    const { netMinor, tradeCount } = nets.get(affiliateId)!;
    await prisma.$transaction(async (tx) => {
      await lockProgramDay(tx, day);
      if (await tx.revenueShareDay.findUnique({ where: { affiliateId_day: { affiliateId, day: dayDate } }, select: { id: true } })) return;
      const prev = await tx.revenueShareDay.findFirst({
        where: { affiliateId, day: { lt: dayDate } },
        orderBy: { day: "desc" },
        select: { carryOutMinor: true },
      });
      const carryInMinor = prev?.carryOutMinor ?? 0;
      // Rate in force at the day's last instant: a rate effective from the next midnight belongs to the next day.
      const rate = await getAffiliateRateAt(affiliateId, new Date(close.getTime() - 1), tx);
      const r = revenueShareOf(netMinor, carryInMinor, rate.revenueShareBps);
      const rsd = await tx.revenueShareDay.create({
        data: { affiliateId, day: dayDate, netGainMinor: netMinor, carryInMinor, rateBps: rate.revenueShareBps, rateId: rate.rateId, tradeCount, ...r },
      });
      if (r.shareMinor <= 0) return;
      // Spec step 1: HELD only for a non-ACTIVE or FROZEN/BANNED affiliate; flagged referrals are already excluded from `net`.
      const hold = await earningHoldReasons(tx, affiliateId, null, false);
      const earning = await tx.programEarning.create({
        data: {
          beneficiaryUserId: affiliateId,
          revenueShareDayId: rsd.id,
          kind: "REVENUE_SHARE",
          amountMinor: r.shareMinor,
          status: hold.length ? "HELD" : "PENDING",
          holdReason: hold.length ? hold.join("; ") : null,
          earnedAt: close,
          settingIds: rate.rateId ? [rate.rateId] : [],
        },
      });
      if (!hold.length) await makeEarningAvailable(tx, earning);
    });
  }
  return affiliates.length;
}
