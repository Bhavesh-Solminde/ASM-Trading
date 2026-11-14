import { USD_INR_RATE } from "@asm/contracts";
import { prisma, type DbTransaction } from "../client";
import type {
  AffiliateProfile,
  AffiliateRate,
  AffiliateStatus,
  FraudFlag,
  KycStatus,
  ProgramEarningStatus,
  ProgramSettingKey,
  UserStatus,
} from "../../generated/prisma/client";
import { ProgramSettingKey as SettingKeys } from "../../generated/prisma/client";
import type { ProgramEarning, ProgramSetting } from "../models";
import { programSettingValueAt } from "./affiliate-profile";
import { ProgramActionRefused } from "./program-errors";

// Affiliate program admin (Affiliate Program spec "Affiliate/admin module").
// Every write: one transaction, a mandatory reason, one AuditLog row.

export const ADMIN_PAGE_SIZE = 50;
/** Clock skew allowed for "effective now" (effectiveFrom may be up to this far in the past). */
export const EFFECTIVE_FROM_TOLERANCE_MS = 60_000;

function cleanReason(reason: string, field = "reason"): string {
  const r = (reason ?? "").trim();
  if (!r) throw new ProgramActionRefused("invalid_input", `A ${field} is required.`);
  if (r.length > 500) throw new ProgramActionRefused("invalid_input", `The ${field} must be at most 500 characters.`);
  return r;
}

/** Validates and returns the effective time actually stored: within the skew tolerance it is clamped to now,
 *  so a change can never start in the past (e.g. on a day that has ended but not yet closed). */
function checkEffectiveFrom(effectiveFrom: Date, now: Date): Date {
  if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.getTime())) {
    throw new ProgramActionRefused("invalid_input", "Invalid effective date.");
  }
  if (effectiveFrom.getTime() < now.getTime() - EFFECTIVE_FROM_TOLERANCE_MS) {
    throw new ProgramActionRefused("invalid_input", "The effective date can't be in the past.");
  }
  return effectiveFrom.getTime() < now.getTime() ? now : effectiveFrom;
}

function checkBps(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new ProgramActionRefused("invalid_input", `${field} must be a whole number of basis points from 0 to 10000.`);
  }
}

const pageArgs = (page: number) => {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  return { page: p, skip: (p - 1) * ADMIN_PAGE_SIZE, take: ADMIN_PAGE_SIZE };
};

// ---------------------------------------------------------------- status

/** Allowed admin transitions: target → from-states. */
const TRANSITIONS: Partial<Record<AffiliateStatus, AffiliateStatus[]>> = {
  ACTIVE: ["PENDING_APPROVAL", "SUSPENDED"],
  SUSPENDED: ["ACTIVE", "PENDING_APPROVAL", "PENDING_VERIFICATION"],
};

/**
 * Approve (PENDING_APPROVAL → ACTIVE), suspend (ACTIVE / PENDING_* → SUSPENDED)
 * or reinstate (SUSPENDED → ACTIVE, only with a verified email). Anything else
 * is `invalid_state`.
 */
export async function setAffiliateStatus(input: {
  userId: string;
  status: AffiliateStatus;
  reason: string;
  actor: string;
}): Promise<AffiliateProfile> {
  const reason = cleanReason(input.reason);
  const from = TRANSITIONS[input.status];
  if (!from) throw new ProgramActionRefused("invalid_state", `Admin can't set status ${input.status}.`);
  return prisma.$transaction(async (tx) => {
    const profile = await tx.affiliateProfile.findUnique({
      where: { userId: input.userId },
      include: { user: { select: { emailVerified: true } } },
    });
    if (!profile) throw new ProgramActionRefused("not_found", "Affiliate not found.");
    if (!from.includes(profile.status)) {
      throw new ProgramActionRefused("invalid_state", `Can't change ${profile.status} to ${input.status}.`);
    }
    if (profile.status === "SUSPENDED" && input.status === "ACTIVE" && !profile.user.emailVerified) {
      throw new ProgramActionRefused("invalid_state", "The affiliate's email is not verified yet.");
    }
    const now = new Date();
    // Conditional on the status just read, so a concurrent change loses instead of being overwritten.
    const moved = await tx.affiliateProfile.updateMany({
      where: { userId: input.userId, status: profile.status },
      data: { status: input.status, statusReason: reason, statusChangedAt: now, statusChangedBy: input.actor },
    });
    if (moved.count !== 1) throw new ProgramActionRefused("invalid_state", "The status changed meanwhile; reload.");
    await tx.auditLog.create({
      data: {
        actorId: input.actor,
        action: "affiliate.status_changed",
        targetType: "AffiliateProfile",
        targetId: input.userId,
        before: { status: profile.status },
        after: { status: input.status, reason },
      },
    });
    return tx.affiliateProfile.findUniqueOrThrow({ where: { userId: input.userId } });
  });
}

// ---------------------------------------------------------------- rates

/** Appends a per-affiliate rate version. depositRewardBps null = use the global setting. No back-dating. */
export async function appendAffiliateRate(input: {
  affiliateId: string;
  revenueShareBps: number;
  depositRewardBps: number | null;
  effectiveFrom: Date;
  reason: string;
  actor: string;
}): Promise<AffiliateRate> {
  const reason = cleanReason(input.reason);
  checkBps(input.revenueShareBps, "Revenue Share");
  if (input.depositRewardBps !== null) checkBps(input.depositRewardBps, "Deposit reward");
  const effectiveFrom = checkEffectiveFrom(input.effectiveFrom, new Date());
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.affiliateId }, select: { role: true, legacySimulated: true } });
    if (!user || user.role !== "AFFILIATE" || user.legacySimulated) {
      throw new ProgramActionRefused("not_found", "Affiliate not found.");
    }
    const before = await tx.affiliateRate.findFirst({
      where: { affiliateId: input.affiliateId, effectiveFrom: { lte: effectiveFrom } },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });
    const row = await tx.affiliateRate.create({
      data: {
        affiliateId: input.affiliateId,
        revenueShareBps: input.revenueShareBps,
        depositRewardBps: input.depositRewardBps,
        effectiveFrom,
        createdBy: input.actor,
        reason,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actor,
        action: "affiliate.rate_assigned",
        targetType: "AffiliateRate",
        targetId: row.id,
        before: { rateId: before?.id ?? null, revenueShareBps: before?.revenueShareBps ?? null, depositRewardBps: before?.depositRewardBps ?? null },
        after: {
          affiliateId: input.affiliateId,
          revenueShareBps: row.revenueShareBps,
          depositRewardBps: row.depositRewardBps,
          effectiveFrom: row.effectiveFrom.toISOString(),
          reason,
        },
      },
    });
    return row;
  });
}

// ---------------------------------------------------------------- settings

const MUST_BE_POSITIVE: ProgramSettingKey[] = [
  "MIN_QUALIFYING_DEPOSIT_INR_MINOR",
  "MIN_QUALIFYING_TRADE_INR_MINOR",
  "PROGRAM_MIN_WITHDRAWAL_INR_MINOR",
];

/**
 * Appends a setting version effective at `effectiveFrom` (>= now − 60 s; never
 * back-dated). Values are non-negative integers; *_BPS ≤ 10000, *_PCT ≤ 100,
 * AFFILIATE_REQUIRES_APPROVAL ∈ {0, 1}; minimum deposit / trade / withdrawal
 * > 0; the regular-user reward may not exceed the minimum qualifying deposit
 * in force at effectiveFrom (checked whichever of the two changes).
 */
export async function appendProgramSetting(input: {
  key: ProgramSettingKey;
  value: number;
  effectiveFrom: Date;
  reason: string;
  actor: string;
}): Promise<ProgramSetting> {
  const reason = cleanReason(input.reason);
  const { key, value } = input;
  if (!Object.values(SettingKeys).includes(key)) throw new ProgramActionRefused("invalid_input", "Unknown setting.");
  if (!Number.isSafeInteger(value) || value < 0) throw new ProgramActionRefused("invalid_input", "The value must be a whole number, 0 or more.");
  if (key.endsWith("_BPS") && value > 10_000) throw new ProgramActionRefused("invalid_input", "Basis points can't exceed 10000.");
  if (key.endsWith("_PCT") && value > 100) throw new ProgramActionRefused("invalid_input", "A percentage can't exceed 100.");
  if (key === "AFFILIATE_REQUIRES_APPROVAL" && value !== 0 && value !== 1) {
    throw new ProgramActionRefused("invalid_input", "Approval must be 0 (off) or 1 (on).");
  }
  if (MUST_BE_POSITIVE.includes(key) && value === 0) throw new ProgramActionRefused("invalid_input", "This minimum must be above 0.");
  const effectiveFrom = checkEffectiveFrom(input.effectiveFrom, new Date());

  return prisma.$transaction(async (tx) => {
    const at = effectiveFrom;
    if (key === "USER_REFERRAL_REWARD_INR_MINOR") {
      const minDep = await programSettingValueAt("MIN_QUALIFYING_DEPOSIT_INR_MINOR", at, tx);
      if (minDep !== null && value > minDep) {
        throw new ProgramActionRefused("invalid_input", "The referral reward can't exceed the minimum qualifying deposit.");
      }
    }
    if (key === "MIN_QUALIFYING_DEPOSIT_INR_MINOR") {
      const reward = await programSettingValueAt("USER_REFERRAL_REWARD_INR_MINOR", at, tx);
      if (reward !== null && value < reward) {
        throw new ProgramActionRefused("invalid_input", "The minimum qualifying deposit can't be below the referral reward.");
      }
    }
    const before = await programSettingValueAt(key, at, tx);
    const row = await tx.programSetting.create({
      data: { key, value, effectiveFrom: at, createdBy: input.actor, reason },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actor,
        action: "program.setting_changed",
        targetType: "ProgramSetting",
        targetId: row.id,
        before: { key, value: before },
        after: { key, value, effectiveFrom: at.toISOString(), reason },
      },
    });
    return row;
  });
}

export type ProgramSettingVersion = ProgramSetting & { inForce: boolean };

/** Every setting version, newest first per key; `inForce` marks the one in force now. */
export async function listProgramSettingHistory(now: Date = new Date()): Promise<ProgramSettingVersion[]> {
  const rows = await prisma.programSetting.findMany({
    orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const seen = new Set<ProgramSettingKey>();
  return rows.map((r) => {
    const inForce = !seen.has(r.key) && r.effectiveFrom.getTime() <= now.getTime();
    if (inForce) seen.add(r.key);
    return { ...r, inForce };
  });
}

// ---------------------------------------------------------------- affiliates

export interface AffiliateAggregates {
  totalReferrals: number;
  qualifiedReferrals: number;
  /** COMPLETED deposits of QUALIFIED referrals, INR paise, by the qualifying-deposit INR rule. */
  totalDepositedMinor: number;
  earnings: Record<ProgramEarningStatus, number>;
  wallet: { availableMinor: number; reservedMinor: number; transferredMinor: number; paidMinor: number } | null;
  currentRate: { rateId: string; revenueShareBps: number; depositRewardBps: number | null; effectiveFrom: Date } | null;
  openSelfReferralFlags: number;
}

export interface AffiliateAdminRow extends AffiliateAggregates {
  userId: string;
  email: string;
  name: string | null;
  status: AffiliateStatus;
  statusReason: string | null;
  statusChangedAt: Date | null;
  emailVerified: boolean;
  kycStatus: KycStatus;
  userStatus: UserStatus;
  createdAt: Date;
}

const emptyEarnings = (): Record<ProgramEarningStatus, number> => ({ PENDING: 0, HELD: 0, VOID: 0, AVAILABLE: 0 });

/** Aggregates for a page of affiliates: a fixed number of grouped queries, independent of page size. */
async function aggregatesFor(ids: string[], now: Date): Promise<Map<string, AffiliateAggregates>> {
  const out = new Map<string, AffiliateAggregates>(
    ids.map((id) => [
      id,
      { totalReferrals: 0, qualifiedReferrals: 0, totalDepositedMinor: 0, earnings: emptyEarnings(), wallet: null, currentRate: null, openSelfReferralFlags: 0 },
    ]),
  );
  if (ids.length === 0) return out;
  const [refs, quals, deposited, earnings, wallets, rates, flags] = await Promise.all([
    prisma.user.groupBy({ by: ["referredById"], where: { referredById: { in: ids } }, _count: { _all: true } }),
    prisma.referralQualification.groupBy({ by: ["inviterId"], where: { inviterId: { in: ids }, status: "QUALIFIED" }, _count: { _all: true } }),
    // Same rule as qualifyingDepositInrMinor: requested INR for UPI rows that have it, USDT-cents × rate, else amountInr.
    prisma.$queryRaw<{ id: string; total: bigint }[]>`
      SELECT q."inviterId" AS id,
             COALESCE(SUM(CASE
               WHEN d.method <> 'USDT' AND d."requestedInrMinor" IS NOT NULL THEN d."requestedInrMinor"
               WHEN d.method = 'USDT' THEN COALESCE(d."amountUsdtMinor", 0) * ${USD_INR_RATE}::bigint
               ELSE d."amountInr" END), 0)::bigint AS total
      FROM "ReferralQualification" q JOIN "Deposit" d ON d."userId" = q."referredUserId"
      WHERE q."inviterId" = ANY(${ids}) AND q.status::text = 'QUALIFIED' AND d.status::text = 'COMPLETED'
      GROUP BY q."inviterId"`,
    prisma.programEarning.groupBy({ by: ["beneficiaryUserId", "status"], where: { beneficiaryUserId: { in: ids } }, _sum: { amountMinor: true } }),
    prisma.programWallet.findMany({ where: { userId: { in: ids } } }),
    prisma.affiliateRate.findMany({
      where: { affiliateId: { in: ids }, effectiveFrom: { lte: now } },
      orderBy: [{ affiliateId: "asc" }, { effectiveFrom: "desc" }, { createdAt: "desc" }],
      distinct: ["affiliateId"],
    }),
    prisma.$queryRaw<{ id: string; n: bigint }[]>`
      SELECT u AS id, COUNT(*)::bigint AS n
      FROM "FraudFlag" f, unnest(f."linkedUserIds") u
      WHERE f.kind::text = 'SELF_REFERRAL' AND f.status::text = 'OPEN' AND u = ANY(${ids})
      GROUP BY u`,
  ]);
  for (const r of refs) if (r.referredById) out.get(r.referredById)!.totalReferrals = r._count._all;
  for (const r of quals) out.get(r.inviterId)!.qualifiedReferrals = r._count._all;
  for (const r of deposited) out.get(r.id)!.totalDepositedMinor = Number(r.total);
  for (const r of earnings) out.get(r.beneficiaryUserId)!.earnings[r.status] = Number(r._sum.amountMinor ?? 0);
  for (const w of wallets) {
    out.get(w.userId)!.wallet = { availableMinor: w.availableMinor, reservedMinor: w.reservedMinor, transferredMinor: w.transferredMinor, paidMinor: w.paidMinor };
  }
  for (const r of rates) {
    out.get(r.affiliateId)!.currentRate = { rateId: r.id, revenueShareBps: r.revenueShareBps, depositRewardBps: r.depositRewardBps, effectiveFrom: r.effectiveFrom };
  }
  for (const f of flags) out.get(f.id)!.openSelfReferralFlags = Number(f.n);
  return out;
}

const profileWithUser = {
  user: { select: { email: true, firstName: true, lastName: true, emailVerified: true, kycStatus: true, status: true } },
} as const;

type ProfileWithUser = AffiliateProfile & {
  user: { email: string; firstName: string | null; lastName: string | null; emailVerified: boolean; kycStatus: KycStatus; status: UserStatus };
};

function toRow(p: ProfileWithUser, agg: AffiliateAggregates): AffiliateAdminRow {
  const name = [p.user.firstName, p.user.lastName].filter(Boolean).join(" ") || null;
  return {
    userId: p.userId,
    email: p.user.email,
    name,
    status: p.status,
    statusReason: p.statusReason,
    statusChangedAt: p.statusChangedAt,
    emailVerified: p.user.emailVerified,
    kycStatus: p.user.kycStatus,
    userStatus: p.user.status,
    createdAt: p.createdAt,
    ...agg,
  };
}

/** Affiliates (non-legacy), newest first, 50 per page; `q` matches email, name or exact user id. */
export async function listAffiliatesForAdmin(input: {
  status?: AffiliateStatus;
  q?: string;
  page?: number;
}): Promise<{ rows: AffiliateAdminRow[]; total: number; page: number; pageSize: number }> {
  const { page, skip, take } = pageArgs(input.page ?? 1);
  const q = input.q?.trim();
  const where = {
    ...(input.status && { status: input.status }),
    user: {
      legacySimulated: false,
      ...(q && {
        OR: [
          { id: q },
          { email: { contains: q, mode: "insensitive" as const } },
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    },
  };
  const [profiles, total] = await Promise.all([
    prisma.affiliateProfile.findMany({ where, include: profileWithUser, orderBy: [{ createdAt: "desc" }, { userId: "asc" }], skip, take }),
    prisma.affiliateProfile.count({ where }),
  ]);
  const aggs = await aggregatesFor(profiles.map((p) => p.userId), new Date());
  return { rows: profiles.map((p) => toRow(p, aggs.get(p.userId)!)), total, page, pageSize: ADMIN_PAGE_SIZE };
}

export interface AffiliateAdminDetail extends AffiliateAdminRow {
  statusChangedBy: string | null;
  /** Every rate version, newest effectiveFrom first. */
  rates: AffiliateRate[];
  /** OPEN or CONFIRMED SELF_REFERRAL flags naming this affiliate. */
  flags: FraudFlag[];
}

export async function getAffiliateAdminDetail(userId: string): Promise<AffiliateAdminDetail | null> {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId }, include: profileWithUser });
  if (!profile) return null;
  const [aggs, rates, flags] = await Promise.all([
    aggregatesFor([userId], new Date()),
    prisma.affiliateRate.findMany({ where: { affiliateId: userId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] }),
    prisma.fraudFlag.findMany({
      where: { kind: "SELF_REFERRAL", status: { in: ["OPEN", "CONFIRMED"] }, linkedUserIds: { has: userId } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { ...toRow(profile, aggs.get(userId)!), statusChangedBy: profile.statusChangedBy, rates, flags };
}

// ---------------------------------------------------------------- earnings review

export type EarningForReview = ProgramEarning & {
  beneficiary: { email: string; role: string; legacySimulated: boolean };
};

/** HELD earnings, or earnings flagged needsReview; oldest first, 50 per page. */
export async function listEarningsForReview(input: {
  filter: "HELD" | "NEEDS_REVIEW";
  page?: number;
}): Promise<{ rows: EarningForReview[]; total: number; page: number; pageSize: number }> {
  const { page, skip, take } = pageArgs(input.page ?? 1);
  const where = input.filter === "HELD" ? { status: "HELD" as const } : { needsReview: true };
  const [rows, total] = await Promise.all([
    prisma.programEarning.findMany({
      where,
      include: { beneficiary: { select: { email: true, role: true, legacySimulated: true } } },
      orderBy: [{ earnedAt: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    prisma.programEarning.count({ where }),
  ]);
  return { rows, total, page, pageSize: ADMIN_PAGE_SIZE };
}

/** Conditionally moves one earning and audits it; `invalid_state` if it is no longer in the expected state. */
async function reviewEarning(
  tx: DbTransaction,
  input: { earningId: string; actor: string; action: string; reason: string },
  expect: { status?: "HELD"; needsReview?: true },
  data: { status?: ProgramEarningStatus; holdReason?: null; voidReason?: string; needsReview?: false; adminReleasedAt?: Date },
): Promise<ProgramEarning> {
  const before = await tx.programEarning.findUnique({ where: { id: input.earningId } });
  if (!before) throw new ProgramActionRefused("not_found", "Earning not found.");
  const moved = await tx.programEarning.updateMany({ where: { id: input.earningId, ...expect }, data });
  if (moved.count !== 1) throw new ProgramActionRefused("invalid_state", "The earning is not in a reviewable state.");
  const after = await tx.programEarning.findUniqueOrThrow({ where: { id: input.earningId } });
  await tx.auditLog.create({
    data: {
      actorId: input.actor,
      action: input.action,
      targetType: "ProgramEarning",
      targetId: input.earningId,
      before: { status: before.status, holdReason: before.holdReason, needsReview: before.needsReview, amountMinor: before.amountMinor },
      after: { status: after.status, voidReason: after.voidReason, needsReview: after.needsReview, reason: input.reason },
    },
  });
  return after;
}

/**
 * HELD → PENDING; the next daily close makes it AVAILABLE. The admin's
 * decision overrides the hold reason, which stays in the audit row.
 */
export async function releaseHeldEarning(input: { earningId: string; actor: string; note: string }): Promise<ProgramEarning> {
  const reason = cleanReason(input.note, "note");
  return prisma.$transaction((tx) =>
    reviewEarning(tx, { ...input, action: "program.earning_released", reason }, { status: "HELD" }, { status: "PENDING", holdReason: null, adminReleasedAt: new Date() }),
  );
}

/** HELD → VOID with the reason (never paid). */
export async function voidHeldEarning(input: { earningId: string; actor: string; reason: string }): Promise<ProgramEarning> {
  const reason = cleanReason(input.reason);
  return prisma.$transaction((tx) =>
    reviewEarning(tx, { ...input, action: "program.earning_voided", reason }, { status: "HELD" }, { status: "VOID", voidReason: reason }),
  );
}

/** needsReview → false; money untouched (any correction is a separate ADJUSTMENT). */
export async function clearNeedsReview(input: { earningId: string; actor: string; note: string }): Promise<ProgramEarning> {
  const reason = cleanReason(input.note, "note");
  return prisma.$transaction((tx) =>
    reviewEarning(tx, { ...input, action: "program.earning_review_cleared", reason }, { needsReview: true }, { needsReview: false }),
  );
}
