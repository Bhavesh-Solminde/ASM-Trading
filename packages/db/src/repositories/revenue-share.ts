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

type Settlement = { userId: string; currency: string; netMinor: number; tradeCount: number };
type FlagState = "OPEN" | "CONFIRMED";
/** RevenueShareDay.calculation: the day's per-friend inputs, replayed when a flag changes. */
type SavedCalculation = { version: 1; settlements: Settlement[]; level?: number | null; levelTermsId?: string | null };

/**
 * Company gain per referred user and trade currency for IST day `day`, real-money
 * part only: per trade −pnl × (stake − stakeFromBonus) / stake, truncated toward
 * zero. Trades of QUALIFIED referrals of non-legacy affiliates, settled (WON /
 * LOST / CLOSED, LIVE) in the day and at/after qualifiedAt; bots and legacy
 * accounts are excluded. Fraud flags are applied later (eligibleNets).
 */
async function settlementsByAffiliate(tx: Pick<DbTransaction, "$queryRaw">, day: string) {
  const start = istDayStart(day);
  const end = istDayStart(addIstDays(day, 1));
  // numeric + div(): exact and truncated toward zero, no bigint overflow on huge positions.
  const rows = await tx.$queryRaw<{ affiliateId: string; userId: string; currency: string; net: string; n: number }[]>`
    SELECT q."inviterId" AS "affiliateId", u.id AS "userId", COALESCE(t.currency, a.currency) AS currency,
           SUM(div((-t.pnl)::numeric * (t.stake - t."stakeFromBonus")::numeric, t.stake::numeric))::text AS net,
           COUNT(*)::int AS n
    FROM "Trade" t
    JOIN "Account" a ON a.id = t."accountId" AND a.type = 'LIVE'
    JOIN "User" u ON u.id = a."userId" AND u."isBot" = false AND u."legacySimulated" = false
    JOIN "ReferralQualification" q ON q."referredUserId" = u.id AND q.status = 'QUALIFIED'
    JOIN "User" inv ON inv.id = q."inviterId" AND inv.role = 'AFFILIATE' AND inv."legacySimulated" = false
    WHERE t.status::text IN ('WON', 'LOST', 'CLOSED') AND t.stake > 0
      AND COALESCE(t."closedAt", t."expiryTs") >= ${start}
      AND COALESCE(t."closedAt", t."expiryTs") < ${end}
      AND COALESCE(t."closedAt", t."expiryTs") >= q."qualifiedAt"
    GROUP BY 1, 2, 3`;
  const out = new Map<string, Settlement[]>();
  for (const r of rows) {
    const list = out.get(r.affiliateId) ?? [];
    list.push({ userId: r.userId, currency: r.currency, netMinor: Number(r.net), tradeCount: r.n });
    out.set(r.affiliateId, list);
  }
  return out;
}

/** Per user: CONFIRMED if any SELF_REFERRAL flag on them is confirmed, else OPEN if one is open. */
async function flagStates(tx: Pick<DbTransaction, "fraudFlag">, ids: string[]) {
  const states = new Map<string, FlagState>();
  if (!ids.length) return states;
  const flags = await tx.fraudFlag.findMany({
    where: { kind: "SELF_REFERRAL", status: { in: ["OPEN", "CONFIRMED"] }, OR: [{ userId: { in: ids } }, { linkedUserIds: { hasSome: ids } }] },
    select: { userId: true, linkedUserIds: true, status: true },
  });
  const wanted = new Set(ids);
  for (const flag of flags) {
    for (const id of new Set([flag.userId, ...flag.linkedUserIds])) {
      if (wanted.has(id) && states.get(id) !== "CONFIRMED") states.set(id, flag.status as FlagState);
    }
  }
  return states;
}

/** Sums per currency, then converts once per currency with the single platform rate. */
function netInr(rows: Settlement[]) {
  const currencies = new Map<string, number>();
  for (const r of rows) currencies.set(r.currency, (currencies.get(r.currency) ?? 0) + r.netMinor);
  let net = 0;
  for (const [currency, minor] of currencies) net += convertMinorBetween(minor, currency === "USDT" ? "USD" : currency, "INR");
  return net;
}

/** Confirmed friends are left out entirely; `clean` also leaves out friends with an open flag. */
function eligibleNets(rows: Settlement[], states: Map<string, FlagState>) {
  const eligible = rows.filter((r) => states.get(r.userId) !== "CONFIRMED");
  return {
    total: netInr(eligible),
    clean: netInr(eligible.filter((r) => !states.has(r.userId))),
    tradeCount: eligible.reduce((n, r) => n + r.tradeCount, 0),
  };
}

/** The clean payout cannot exceed the result calculated without unresolved referrals, including past carry. */
export function splitRevenueShare(shareMinor: number, cleanShareMinor: number) {
  const cleanMinor = Math.min(shareMinor, cleanShareMinor);
  return { cleanMinor, heldMinor: shareMinor - cleanMinor };
}

/** Per-transaction lock that serialises every close step of one IST day across processes. */
export const lockProgramDay = (tx: Pick<DbTransaction, "$queryRaw">, day: string) =>
  tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`program-day-close:${day}`}))`;

/**
 * Writes the RevenueShareDay rows for `day` and, for a positive share, up to
 * two REVENUE_SHARE earnings: CLEAN, AVAILABLE at once (or HELD), and FLAGGED,
 * the part that depends on friends with an open self-referral flag, always HELD.
 * The day uses the rate in force at its start. Confirmed friends are left out.
 * Carry-in is replayed from the saved inputs of earlier days under today's flag
 * states, so a flag confirmed or dismissed later fixes the carry from now on;
 * closed days and money already paid are never changed. One small transaction
 * per affiliate under the day lock; an affiliate whose row already exists is
 * skipped, so re-running is safe. Returns the affiliate count.
 */
export async function computeRevenueShareDay(day: string): Promise<number> {
  const start = istDayStart(day);
  const close = istDayStart(addIstDays(day, 1));
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const nets = await settlementsByAffiliate(prisma, day);
  for (const affiliateId of [...nets.keys()].sort()) {
    await prisma.$transaction(async (tx) => {
      await lockProgramDay(tx, day);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`program-revenue-share:${affiliateId}`}))`;
      if (await tx.revenueShareDay.findUnique({ where: { affiliateId_day: { affiliateId, day: dayDate } }, select: { id: true } })) return;
      const history = await tx.revenueShareDay.findMany({ where: { affiliateId, day: { lt: dayDate } }, orderBy: { day: "asc" } });
      const priorInputs = history.map((row) => (row.calculation as unknown as SavedCalculation).settlements);
      const current = nets.get(affiliateId)!;
      const userIds = [...new Set([...priorInputs.flat(), ...current].map((r) => r.userId))];
      const states = await flagStates(tx, userIds);
      let carryInMinor = history[0]?.carryInMinor ?? 0;
      let cleanCarry = carryInMinor;
      for (let i = 0; i < history.length; i++) {
        const row = history[i]!;
        const net = eligibleNets(priorInputs[i]!, states);
        const total = revenueShareOf(net.total, carryInMinor, row.rateBps);
        const clean = revenueShareOf(net.clean, cleanCarry, row.rateBps);
        carryInMinor = total.carryOutMinor;
        cleanCarry = clean.carryOutMinor;
      }
      const net = eligibleNets(current, states);
      const rate = await getAffiliateRateAt(affiliateId, start, tx);
      const usesLevel = rate.source === "level";
      const r = revenueShareOf(net.total, carryInMinor, rate.revenueShareBps);
      const clean = revenueShareOf(net.clean, cleanCarry, rate.revenueShareBps);
      const rsd = await tx.revenueShareDay.create({
        data: { affiliateId, day: dayDate, netGainMinor: net.total, carryInMinor, rateBps: rate.revenueShareBps, rateId: rate.rateId,
          tradeCount: net.tradeCount, ...r, calculation: {
            version: 1,
            settlements: current.map((s) => ({ ...s })),
            level: usesLevel ? rate.level : null,
            levelTermsId: usesLevel ? rate.levelTermsId : null,
          } satisfies SavedCalculation },
      });
      const base = { beneficiaryUserId: affiliateId, revenueShareDayId: rsd.id, earnedAt: close,
        settingIds: [rate.rateId ?? rate.levelTermsId ?? rate.settingId].filter((id): id is string => !!id) };
      const hold = await earningHoldReasons(tx, affiliateId, null, false);
      const relatedUserIds = userIds.filter((id) => states.get(id) === "OPEN").sort();
      const { cleanMinor, heldMinor } = splitRevenueShare(r.shareMinor, clean.shareMinor);
      // Spec step 1: the clean part is HELD only for a non-ACTIVE or FROZEN/BANNED affiliate.
      if (cleanMinor > 0) {
        const earning = await tx.programEarning.create({ data: { ...base, kind: "REVENUE_SHARE", revenueSharePart: "CLEAN", amountMinor: cleanMinor,
          status: hold.length ? "HELD" : "PENDING", holdReason: hold.length ? hold.join("; ") : null } });
        if (!hold.length) await makeEarningAvailable(tx, earning);
      }
      // Released by a later daily close once no flag on these friends (or other hold reason) remains.
      if (heldMinor > 0) {
        await tx.programEarning.create({ data: { ...base, kind: "REVENUE_SHARE", revenueSharePart: "FLAGGED", amountMinor: heldMinor,
          status: "HELD", holdReason: [FLAGGED_REFERRAL_HOLD_REASON, ...hold].join("; "), relatedUserIds } });
      }
    }, { timeout: 30_000 });
  }
  return nets.size;
}
