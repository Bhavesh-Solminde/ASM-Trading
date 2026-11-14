import { convertMinorBetween, USD_INR_RATE } from "@asm/contracts";
import { logger } from "@asm/logger";
import { prisma, type DbTransaction } from "../client";
import type { ProgramEarningKind, TradeStatus } from "../../generated/prisma/client";
import type { Deposit } from "../models";
import { getAffiliateRateAt } from "./affiliate-rate";
import { depositCreditMinor } from "./deposit-credit-currency";
import { getProgramSettings, listProgramSettingRows, settingsAt } from "./program-settings";

// Affiliate Program phase 4 — Affiliate Program spec.

export type QualificationOutcome = "not_referred" | "not_yet" | "qualified" | "already";

const SETTLED: TradeStatus[] = ["WON", "LOST", "CLOSED"];

type Db = Pick<DbTransaction, "fraudFlag">;

/** Real-money part of a stake in INR paise via the platform's single FX rate (USDT-cents count as USD-cents, as for deposits). */
export function realStakeInrMinor(stake: number, stakeFromBonus: number, currency: string): number {
  return convertMinorBetween(stake - stakeFromBonus, currency === "USDT" ? "USD" : currency, "INR");
}

/**
 * A deposit's value for qualification and the affiliate reward, in INR paise:
 * what a UPI payer REQUESTED (product decision 13 Nov 2026 — the matching
 * offset must not push a ₹500 request under the minimum), else the credit
 * value (USDT, and UPI rows that predate requestedInrMinor).
 */
export function qualifyingDepositInrMinor(
  d: Pick<Deposit, "method" | "amountInr" | "amountUsd" | "amountUsdtMinor" | "requestedInrMinor">,
): number {
  if (d.method !== "USDT" && d.requestedInrMinor !== null) return d.requestedInrMinor;
  return depositCreditMinor(d, "INR");
}

/** OPEN or CONFIRMED SELF_REFERRAL flag owned by, or naming, any of these users. */
async function hasSelfReferralFlag(db: Db, userIds: string[]): Promise<boolean> {
  const n = await db.fraudFlag.count({
    where: {
      kind: "SELF_REFERRAL",
      status: { in: ["OPEN", "CONFIRMED"] },
      OR: [{ userId: { in: userIds } }, { linkedUserIds: { hasSome: userIds } }],
    },
  });
  return n > 0;
}

/**
 * Extra bonus percentage for an invited user's first-ever credited deposit
 * (§8), or 0. Called inside the deposit-credit transaction, only for a referred
 * user's deposit #1 that earns the ordinary bonus. 0 when a deposit was ever
 * credited to the account before (a reversal must not make the next one
 * "first"), when a self-referral flag stands, or when the setting can't be
 * read: this must never roll back the credit.
 */
export async function inviteExtraBonusPct(
  tx: Pick<DbTransaction, "fraudFlag" | "programSetting" | "transaction">,
  input: { userId: string; accountId: string; at: Date },
): Promise<{ pct: number; settingId: string | null }> {
  const none = { pct: 0, settingId: null };
  const earlier = await tx.transaction.count({
    where: { accountId: input.accountId, refType: "Deposit", kind: "DEPOSIT", amount: { gt: 0 } },
  });
  if (earlier > 0) return none;
  if (await hasSelfReferralFlag(tx, [input.userId])) return none;
  try {
    const s = await getProgramSettings(input.at, tx);
    return { pct: s.values.INVITE_EXTRA_BONUS_PCT, settingId: s.ids.INVITE_EXTRA_BONUS_PCT };
  } catch (err) {
    logger.error({ evt: "referral.invite_bonus_setting_missing", userId: input.userId, err }, "invite extra bonus setting unavailable; granting none");
    return none;
  }
}

/**
 * The extra % an invited user's next deposit would get, for the deposit-page preview. Same rule as
 * the credit (`creditDepositToAccount`): referred, nothing credited yet, no self-referral flag.
 * Read-only; the ordinary bonus tier still has to apply for the extra to be granted.
 */
export async function inviteExtraBonusPreviewPct(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referredById: true } });
  if (!user?.referredById) return 0;
  const account = await prisma.account.findFirst({ where: { userId, type: "LIVE" }, select: { id: true } });
  if (!account) return 0;
  return (await inviteExtraBonusPct(prisma, { userId, accountId: account.id, at: new Date() })).pct;
}

interface Evidence {
  id: string;
  at: Date;
  inr: number;
}

const byTime = (a: Evidence, b: Evidence) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id);

/**
 * Earliest settled LIVE trade on `accountId` with real-money stake >= minInr
 * INR paise, settled within [from, to]. The stake is converted by multiplying
 * with the single platform rate (exact, no rounding). Walks Trade(accountId, createdAt).
 */
async function earliestTrade(accountId: string, minInr: number, from: Date, to: Date): Promise<Evidence | null> {
  const rows = await prisma.$queryRaw<{ id: string; stake: bigint; fromBonus: bigint; currency: string; at: Date }[]>`
    SELECT t.id, t.stake, t."stakeFromBonus" AS "fromBonus", COALESCE(t.currency, a.currency) AS currency,
           COALESCE(t."closedAt", t."expiryTs") AS at
    FROM "Trade" t JOIN "Account" a ON a.id = t."accountId"
    WHERE t."accountId" = ${accountId}
      AND t.status::text IN ('WON', 'LOST', 'CLOSED')
      AND (t.stake - t."stakeFromBonus")
          * (CASE WHEN COALESCE(t.currency, a.currency) IN ('USD', 'USDT') THEN ${USD_INR_RATE}::bigint ELSE 1 END) >= ${minInr}
      AND COALESCE(t."closedAt", t."expiryTs") BETWEEN ${from} AND ${to}
    ORDER BY at, t.id
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, at: r.at, inr: realStakeInrMinor(Number(r.stake), Number(r.fromBonus), r.currency) };
}

/**
 * Qualifies a referred user once both a qualifying COMPLETED deposit and a
 * qualifying settled LIVE trade exist (any order), and records the inviter's
 * one-time earning. T, the moment the second condition is met, is always the
 * time of a deposit credit or trade settlement that qualifies under the
 * thresholds in force at that time; a setting change alone never qualifies
 * anyone retroactively (§14). Idempotent and race-safe: the unique
 * referredUserId (and (qualificationId, kind)) make a concurrent second insert
 * fail as "already". Evidence after `now` is ignored.
 */
export async function evaluateReferralQualification(
  userId: string,
  now: Date = new Date(),
): Promise<{ outcome: QualificationOutcome }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      referredById: true,
      isBot: true,
      legacySimulated: true,
      referralQualification: { select: { id: true } },
      accounts: { where: { type: "LIVE" }, select: { id: true } },
    },
  });
  if (!user?.referredById) return { outcome: "not_referred" };
  if (user.referralQualification) return { outcome: "already" };
  const live = user.accounts[0];
  if (user.isBot || user.legacySimulated || !live) return { outcome: "not_yet" };

  const versions = (await listProgramSettingRows()).filter((r) => r.effectiveFrom.getTime() <= now.getTime());
  const minDeps = versions.filter((r) => r.key === "MIN_QUALIFYING_DEPOSIT_INR_MINOR").map((r) => r.value);
  if (minDeps.length === 0) return { outcome: "not_yet" };
  const minDepEver = Math.min(...minDeps);

  // Cheap bail before any trade lookup. A superset filter in SQL (USDT rows carry
  // a negative amountInr sentinel); qualifyingDepositInrMinor decides below.
  const deposits = await prisma.deposit.findMany({
    where: {
      userId,
      status: "COMPLETED",
      OR: [
        { method: { not: "USDT" }, amountInr: { gte: minDepEver } },
        { method: { not: "USDT" }, requestedInrMinor: { gte: minDepEver } },
        { method: "USDT", amountUsdtMinor: { gte: Math.ceil(minDepEver / USD_INR_RATE) } },
      ],
    },
    select: { id: true, method: true, amountInr: true, amountUsd: true, amountUsdtMinor: true, requestedInrMinor: true, updatedAt: true },
  });
  if (deposits.length === 0) return { outcome: "not_yet" };

  // Credited at = the ledger's DEPOSIT credit row; updatedAt only for a legacy row without one.
  const credits = await prisma.transaction.findMany({
    where: { accountId: live.id, refType: "Deposit", kind: "DEPOSIT", amount: { gt: 0 }, refId: { in: deposits.map((d) => d.id) } },
    select: { refId: true, createdAt: true },
  });
  const depEv: Evidence[] = [];
  for (const d of deposits) {
    let inr: number;
    try {
      inr = qualifyingDepositInrMinor(d);
    } catch {
      continue;
    }
    const at = credits.find((c) => c.refId === d.id)?.createdAt ?? d.updatedAt;
    if (at.getTime() <= now.getTime()) depEv.push({ id: d.id, at, inr });
  }
  depEv.sort(byTime);

  // Walk the threshold windows in time order. In window [start, end) with
  // thresholds (D, M), dep/trade are the earliest evidence meeting D/M. If the
  // later of the two falls inside the window, that is T. If both predate the
  // window, T is the first evidence inside the window that itself meets D or M.
  // Bounded: at most 2 trade lookups per window, each LIMIT 1.
  const starts = [
    ...new Set(
      versions
        .filter((r) => r.key === "MIN_QUALIFYING_DEPOSIT_INR_MINOR" || r.key === "MIN_QUALIFYING_TRADE_INR_MINOR")
        .map((r) => r.effectiveFrom.getTime()),
    ),
  ].sort((a, b) => a - b);
  let found: { T: Date; dep: Evidence; trade: Evidence; settings: ReturnType<typeof settingsAt> } | null = null;
  for (let i = 0; i < starts.length && !found; i++) {
    const start = starts[i]!;
    const end = Math.min(starts[i + 1] ?? Infinity, now.getTime() + 1);
    let window: ReturnType<typeof settingsAt>;
    try {
      window = settingsAt(versions, new Date(start));
    } catch {
      continue; // not every key in force yet
    }
    const D = window.values.MIN_QUALIFYING_DEPOSIT_INR_MINOR;
    const M = window.values.MIN_QUALIFYING_TRADE_INR_MINOR;
    const dep = depEv.find((e) => e.inr >= D);
    if (!dep) continue;
    const trade = await earliestTrade(live.id, M, new Date(0), now);
    if (!trade) continue;
    const later = Math.max(dep.at.getTime(), trade.at.getTime());
    let T: number | null = null;
    if (later >= start && later < end) {
      T = later;
    } else if (later < start) {
      const depIn = depEv.find((e) => e.inr >= D && e.at.getTime() >= start && e.at.getTime() < end);
      const tradeIn = await earliestTrade(live.id, M, new Date(start), new Date(end - 1));
      const times = [depIn?.at.getTime(), tradeIn?.at.getTime()].filter((t): t is number => t !== undefined);
      if (times.length > 0) T = Math.min(...times);
    }
    if (T !== null) found = { T: new Date(T), dep, trade, settings: settingsAt(versions, new Date(T)) };
  }
  if (!found) return { outcome: "not_yet" };
  const { T, dep, trade, settings } = found;

  const inviterId = user.referredById;
  const inviter = await prisma.user.findUniqueOrThrow({
    where: { id: inviterId },
    select: { role: true, legacySimulated: true },
  });
  let kind: ProgramEarningKind | null = null;
  let amountMinor = 0;
  let rateId: string | null = null;
  if (inviter.role === "USER") {
    kind = "REFERRAL_REWARD";
    amountMinor = settings.values.USER_REFERRAL_REWARD_INR_MINOR;
  } else if (inviter.role === "AFFILIATE" && !inviter.legacySimulated) {
    kind = "AFFILIATE_DEPOSIT_REWARD";
    // A per-affiliate rate in force at T overrides the global setting (Phase 7).
    const rate = await getAffiliateRateAt(inviterId, T);
    const bps = rate.depositRewardBps ?? settings.values.AFFILIATE_DEPOSIT_REWARD_BPS;
    if (rate.depositRewardBps !== null) rateId = rate.rateId;
    amountMinor = Math.floor((dep.inr * bps) / 10_000);
  }
  const settingIds = Object.values(settings.ids);

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialises with a concurrent reversal of this deposit (its UPDATE waits on this lock, or we see REJECTED).
      const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM "Deposit" WHERE id = ${dep.id} FOR SHARE`;
      if (row?.status !== "COMPLETED") return { outcome: "not_yet" as const };

      // Hold checks read inside the transaction so a status change or flag just before the insert is seen.
      const holdReasons: string[] = [];
      const current = await tx.user.findUniqueOrThrow({ where: { id: inviterId }, select: { status: true } });
      if (current.status === "FROZEN" || current.status === "BANNED") holdReasons.push(`inviter ${current.status}`);
      if (await hasSelfReferralFlag(tx, [userId, inviterId])) holdReasons.push("self-referral flag open or confirmed");
      if (kind === "AFFILIATE_DEPOSIT_REWARD") {
        const profile = await tx.affiliateProfile.findUnique({ where: { userId: inviterId }, select: { status: true } });
        if (profile?.status !== "ACTIVE") holdReasons.push("affiliate not active");
      }

      const q = await tx.referralQualification.create({
        data: {
          referredUserId: userId,
          inviterId,
          firstDepositId: dep.id,
          qualifyingTradeId: trade.id,
          depositInrMinor: dep.inr,
          tradeRealStakeInrMinor: trade.inr,
          minDepositInrMinor: settings.values.MIN_QUALIFYING_DEPOSIT_INR_MINOR,
          minTradeInrMinor: settings.values.MIN_QUALIFYING_TRADE_INR_MINOR,
          settingIds,
          qualifiedAt: T,
        },
      });
      const earning = kind
        ? await tx.programEarning.create({
            data: {
              beneficiaryUserId: inviterId,
              qualificationId: q.id,
              kind,
              amountMinor,
              status: holdReasons.length > 0 ? "HELD" : "PENDING",
              holdReason: holdReasons.length > 0 ? holdReasons.join("; ") : null,
              earnedAt: T,
              settingIds,
            },
          })
        : null;
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: "referral.qualified",
          targetType: "ReferralQualification",
          targetId: q.id,
          after: {
            referredUserId: userId,
            inviterId,
            firstDepositId: dep.id,
            qualifyingTradeId: trade.id,
            earningId: earning?.id ?? null,
            kind,
            amountMinor: earning ? amountMinor : null,
            affiliateRateId: rateId,
            status: earning?.status ?? null,
          },
        },
      });
      return { outcome: "qualified" as const };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { outcome: "already" };
    throw err;
  }
}

/**
 * Referred users with no qualification row yet who have at least one completed
 * deposit and one settled LIVE trade — the sweep job's candidates. Page with
 * `afterId` (the last id of the previous page) so users that never qualify
 * can't starve the rest.
 */
export async function listUnqualifiedReferredUserIds(limit: number, afterId?: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      referredById: { not: null },
      referralQualification: { is: null },
      isBot: false,
      legacySimulated: false,
      deposits: { some: { status: "COMPLETED" } },
      accounts: { some: { type: "LIVE", trades: { some: { status: { in: SETTLED } } } } },
      ...(afterId ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: "asc" },
    take: Math.min(Math.max(limit, 1), 1000),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * §15: the qualifying deposit was reversed. Marks the qualification REVERSED
 * (never deleted, never re-opened here), voids a PENDING/HELD earning and flags
 * any later-state earning for admin review without touching money. Runs inside
 * the reversal transaction; a no-op when the deposit qualified nobody.
 */
export async function reverseQualificationForDeposit(
  tx: Pick<DbTransaction, "referralQualification" | "programEarning" | "auditLog">,
  input: { depositId: string; reason: string; actorId: string | null },
): Promise<void> {
  const q = await tx.referralQualification.findFirst({
    where: { firstDepositId: input.depositId, status: "QUALIFIED" },
    select: { id: true },
  });
  if (!q) return;
  const reason = `Qualifying deposit ${input.depositId} reversed: ${input.reason}`;
  await tx.referralQualification.update({
    where: { id: q.id },
    data: { status: "REVERSED", reversedAt: new Date(), reversedReason: reason },
  });
  const voided = await tx.programEarning.updateMany({
    where: { qualificationId: q.id, status: { in: ["PENDING", "HELD"] } },
    data: { status: "VOID", voidReason: reason },
  });
  const review = await tx.programEarning.updateMany({
    where: { qualificationId: q.id, status: { notIn: ["PENDING", "HELD", "VOID"] } },
    data: { needsReview: true },
  });
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: "referral.qualification_reversed",
      targetType: "ReferralQualification",
      targetId: q.id,
      after: { status: "REVERSED", depositId: input.depositId, reason: input.reason, voided: voided.count, needsReview: review.count },
    },
  });
}
