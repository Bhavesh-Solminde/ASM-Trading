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

/** Hold reason of the FLAGGED part of a Revenue Share day. */
export const FLAGGED_REFERRAL_HOLD_REASON = "self-referral flag on a referred user";

export interface AffiliateDayNet {
  netMinor: number;
  tradeCount: number;
  /** Part of netMinor from referred users with an OPEN/CONFIRMED SELF_REFERRAL flag now. */
  flaggedNetMinor: number;
  flaggedUserIds: string[];
}

/**
 * Company gain in INR paise per affiliate for IST day `day`, real-money part
 * only: per trade −pnl × (stake − stakeFromBonus) / stake, truncated toward
 * zero in the trade currency, then converted with the single platform rate.
 * Trades of QUALIFIED referrals of non-legacy affiliates, settled (WON / LOST /
 * CLOSED, LIVE) in the day and at/after qualifiedAt; bots and legacy accounts
 * are excluded. Referred users with an OPEN/CONFIRMED SELF_REFERRAL flag count
 * in the net and are also reported apart (their share is held, not dropped).
 */
export async function revenueShareNetByAffiliate(
  tx: Pick<DbTransaction, "$queryRaw">,
  day: string,
): Promise<Map<string, AffiliateDayNet>> {
  const start = istDayStart(day);
  const end = istDayStart(addIstDays(day, 1));
  // numeric + div(): exact and truncated toward zero, no bigint overflow on huge positions.
  const rows = await tx.$queryRaw<{ affiliateId: string; currency: string; flagged: boolean; net: string; n: number; userIds: string[] }[]>`
    SELECT x."affiliateId", x.currency, x.flagged, SUM(x.net)::text AS net, COUNT(*)::int AS n, array_agg(DISTINCT x."userId") AS "userIds"
    FROM (
      SELECT q."inviterId" AS "affiliateId", COALESCE(t.currency, a.currency) AS currency, u.id AS "userId",
             div((-t.pnl)::numeric * (t.stake - t."stakeFromBonus")::numeric, t.stake::numeric) AS net,
             EXISTS (
               SELECT 1 FROM "FraudFlag" f
               WHERE f.kind = 'SELF_REFERRAL' AND f.status IN ('OPEN', 'CONFIRMED')
                 AND (f."userId" = u.id OR u.id = ANY(f."linkedUserIds"))) AS flagged
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
    ) x
    GROUP BY 1, 2, 3`;
  // Raw (trade-currency) sums per affiliate and currency, converted once per currency as before the split.
  const raw = new Map<string, { total: Map<string, number>; flagged: Map<string, number>; tradeCount: number; flaggedUserIds: Set<string> }>();
  for (const r of rows) {
    const cur = raw.get(r.affiliateId) ?? { total: new Map(), flagged: new Map(), tradeCount: 0, flaggedUserIds: new Set<string>() };
    const net = Number(r.net);
    cur.total.set(r.currency, (cur.total.get(r.currency) ?? 0) + net);
    if (r.flagged) {
      cur.flagged.set(r.currency, (cur.flagged.get(r.currency) ?? 0) + net);
      for (const id of r.userIds) cur.flaggedUserIds.add(id);
    }
    cur.tradeCount += r.n;
    raw.set(r.affiliateId, cur);
  }
  const toInr = (byCurrency: Map<string, number>) => {
    let inr = 0;
    for (const [currency, minor] of byCurrency) inr += convertMinorBetween(minor, currency === "USDT" ? "USD" : currency, "INR");
    return inr;
  };
  const out = new Map<string, AffiliateDayNet>();
  for (const [affiliateId, r] of raw) {
    out.set(affiliateId, {
      netMinor: toInr(r.total),
      tradeCount: r.tradeCount,
      flaggedNetMinor: toInr(r.flagged),
      flaggedUserIds: [...r.flaggedUserIds].sort(),
    });
  }
  return out;
}

/**
 * Splits a day's share: the part attributable to flagged friends (their
 * positive net at the day's rate, capped at the share) is held, the rest is clean.
 */
export function splitRevenueShare(shareMinor: number, flaggedNetMinor: number, rateBps: number) {
  const heldMinor = Math.min(shareMinor, Math.floor((Math.max(0, flaggedNetMinor) * rateBps) / 10_000));
  return { cleanMinor: shareMinor - heldMinor, heldMinor };
}

/** Per-transaction lock that serialises every close step of one IST day across processes. */
export const lockProgramDay = (tx: Pick<DbTransaction, "$queryRaw">, day: string) =>
  tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`program-day-close:${day}`}))`;

/**
 * Writes the RevenueShareDay rows for `day` and, for a positive share, up to
 * two REVENUE_SHARE earnings: CLEAN, AVAILABLE at once (or HELD), and FLAGGED,
 * the share from self-referral-flagged friends, always HELD. One small
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
    const { netMinor, tradeCount, flaggedNetMinor, flaggedUserIds } = nets.get(affiliateId)!;
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
      const { cleanMinor, heldMinor } = splitRevenueShare(r.shareMinor, flaggedNetMinor, rate.revenueShareBps);
      // Spec step 1: the clean part is HELD only for a non-ACTIVE or FROZEN/BANNED affiliate.
      const hold = await earningHoldReasons(tx, affiliateId, null, false);
      const base = {
        beneficiaryUserId: affiliateId,
        revenueShareDayId: rsd.id,
        kind: "REVENUE_SHARE" as const,
        earnedAt: close,
        settingIds: [rate.rateId ?? rate.settingId].filter((id): id is string => !!id),
      };
      if (cleanMinor > 0) {
        const earning = await tx.programEarning.create({
          data: {
            ...base,
            revenueSharePart: "CLEAN",
            amountMinor: cleanMinor,
            status: hold.length ? "HELD" : "PENDING",
            holdReason: hold.length ? hold.join("; ") : null,
          },
        });
        if (!hold.length) await makeEarningAvailable(tx, earning);
      }
      if (heldMinor > 0) {
        // Released by a later daily close once no flag on these friends (or other hold reason) remains.
        await tx.programEarning.create({
          data: {
            ...base,
            revenueSharePart: "FLAGGED",
            amountMinor: heldMinor,
            status: "HELD",
            holdReason: [FLAGGED_REFERRAL_HOLD_REASON, ...hold].join("; "),
            relatedUserIds: flaggedUserIds,
          },
        });
      }
    });
  }
  return affiliates.length;
}
