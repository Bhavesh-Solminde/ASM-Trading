import { prisma, type DbTransaction } from "../client";
import type { AffiliateStatus, KycStatus, ProgramLedgerKind, ProgramSettingKey } from "../../generated/prisma/client";
import { getAffiliateRateAt } from "./affiliate-rate";
import { ProgramActionRefused } from "./program-errors";
import { houseDateForInstant } from "./house-day";
import { qualifyingDepositInrMinor } from "./referral-qualification";

// Affiliate Program phases 5–6 money core — Affiliate Program spec.

export type ProgramRefusalCode =
  | "insufficient_funds"
  | "below_minimum"
  | "limit_day"
  | "limit_week"
  | "limit_month"
  | "kyc_required"
  | "affiliate_not_active"
  | "account_frozen"
  | "no_live_account"
  | "invalid_state"
  | "invalid_amount"
  | "not_found";

// One shared error class with the affiliate/admin module (instanceof must match across both).
export { ProgramActionRefused };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

// ---------- IST calendar (UTC+5:30, no DST) ----------

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** "YYYY-MM-DD" IST calendar day of an instant. */
export function istDay(instant: Date): string {
  return houseDateForInstant(instant).toISOString().slice(0, 10);
}

/** The instant IST day `day` starts (00:00 Asia/Kolkata). Throws on a malformed day. */
export function istDayStart(day: string): Date {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) throw new Error(`Invalid IST day: ${day}`);
  return new Date(ms - IST_OFFSET_MS);
}

/** `day` plus `n` calendar days. */
export function addIstDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Start instants of the IST calendar day, Monday–Sunday week and calendar month containing `now`. */
export function istLimitWindows(now: Date): {
  dayStart: Date;
  weekStart: Date;
  monthStart: Date;
} {
  const d = houseDateForInstant(now); // UTC midnight of the IST date
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  return {
    dayStart: new Date(d.getTime() - IST_OFFSET_MS),
    weekStart: new Date(d.getTime() - mondayOffset * DAY_MS - IST_OFFSET_MS),
    monthStart: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST_OFFSET_MS),
  };
}

// ---------- settings ----------

type SettingsClient = Pick<DbTransaction, "programSetting">;

/** Every program setting in force at `at` (latest effectiveFrom <= at; a later-created row wins a tie). */
export async function programSettingValuesAt(
  at: Date,
  client: SettingsClient = prisma,
): Promise<Partial<Record<ProgramSettingKey, number>>> {
  const rows = await client.programSetting.findMany({
    where: { effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    select: { key: true, value: true },
  });
  const out: Partial<Record<ProgramSettingKey, number>> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function required(values: Partial<Record<ProgramSettingKey, number>>, key: ProgramSettingKey): number {
  const v = values[key];
  if (v === undefined) throw new Error(`No ProgramSetting ${key} in force.`);
  return v;
}

export function withdrawalRules(values: Partial<Record<ProgramSettingKey, number>>) {
  return {
    minWithdrawalMinor: required(values, "PROGRAM_MIN_WITHDRAWAL_INR_MINOR"),
    limits: {
      day: required(values, "PROGRAM_WITHDRAWALS_PER_DAY"),
      week: required(values, "PROGRAM_WITHDRAWALS_PER_WEEK"),
      month: required(values, "PROGRAM_WITHDRAWALS_PER_MONTH"),
    },
  };
}

// ---------- wallet ----------

export interface WalletBalances {
  availableMinor: number;
  reservedMinor: number;
  transferredMinor: number;
  paidMinor: number;
}

type WalletTx = Pick<DbTransaction, "$executeRaw" | "$queryRaw" | "programWallet" | "programLedgerEntry">;

/** Creates the wallet if missing, then row-locks it (SELECT … FOR UPDATE) for the rest of the transaction. */
export async function lockProgramWallet(tx: WalletTx, userId: string): Promise<WalletBalances> {
  await tx.$executeRaw`INSERT INTO "ProgramWallet" ("userId", "updatedAt") VALUES (${userId}, NOW()) ON CONFLICT ("userId") DO NOTHING`;
  const [w] = await tx.$queryRaw<{ a: bigint; r: bigint; t: bigint; p: bigint }[]>`
    SELECT "availableMinor" AS a, "reservedMinor" AS r, "transferredMinor" AS t, "paidMinor" AS p
    FROM "ProgramWallet" WHERE "userId" = ${userId} FOR UPDATE`;
  if (!w) throw new Error(`ProgramWallet ${userId} missing after upsert.`);
  return {
    availableMinor: Number(w.a),
    reservedMinor: Number(w.r),
    transferredMinor: Number(w.t),
    paidMinor: Number(w.p),
  };
}

/**
 * Applies signed deltas to a wallet locked by lockProgramWallet and writes its
 * ledger entry. (kind, refType, refId) is unique: a duplicate aborts the whole
 * transaction, so callers check state under the lock first and treat P2002 as
 * "already applied" outside it.
 */
export async function moveProgramWallet(
  tx: WalletTx,
  userId: string,
  locked: WalletBalances,
  delta: Partial<WalletBalances>,
  entry: {
    kind: ProgramLedgerKind;
    refType: string;
    refId: string;
    createdBy?: string | null;
    note?: string | null;
  },
): Promise<WalletBalances> {
  const after: WalletBalances = {
    availableMinor: locked.availableMinor + (delta.availableMinor ?? 0),
    reservedMinor: locked.reservedMinor + (delta.reservedMinor ?? 0),
    transferredMinor: locked.transferredMinor + (delta.transferredMinor ?? 0),
    paidMinor: locked.paidMinor + (delta.paidMinor ?? 0),
  };
  if (Object.values(after).some((v) => v < 0 || !Number.isSafeInteger(v))) {
    throw new Error(`Program wallet ${userId} would go negative: ${JSON.stringify(after)}`);
  }
  await tx.programWallet.update({ where: { userId }, data: after });
  await tx.programLedgerEntry.create({
    data: {
      userId,
      kind: entry.kind,
      amountMinor: delta.availableMinor ?? 0,
      availableAfter: after.availableMinor,
      reservedAfter: after.reservedMinor,
      refType: entry.refType,
      refId: entry.refId,
      createdBy: entry.createdBy ?? null,
      note: entry.note ?? null,
    },
  });
  return after;
}

type HoldTx = Pick<DbTransaction, "user" | "fraudFlag">;

/** Why an earning for this beneficiary (and referred user) must be HELD now; [] when it may be paid. */
export async function earningHoldReasons(
  tx: HoldTx,
  beneficiaryUserId: string,
  referredUserId: string | null,
  checkSelfReferral = true,
): Promise<string[]> {
  const u = await tx.user.findUnique({
    where: { id: beneficiaryUserId },
    select: {
      status: true,
      role: true,
      legacySimulated: true,
      affiliateProfile: { select: { status: true } },
    },
  });
  if (!u) return ["beneficiary missing"];
  const reasons: string[] = [];
  if (u.status === "FROZEN" || u.status === "BANNED") reasons.push(`beneficiary ${u.status}`);
  if (u.legacySimulated) reasons.push("legacy simulated account");
  else if (u.role === "AFFILIATE" && u.affiliateProfile?.status !== "ACTIVE") reasons.push("affiliate not active");
  if (!checkSelfReferral) return reasons;
  const ids = referredUserId ? [beneficiaryUserId, referredUserId] : [beneficiaryUserId];
  const flags = await tx.fraudFlag.count({
    where: {
      kind: "SELF_REFERRAL",
      status: { in: ["OPEN", "CONFIRMED"] },
      OR: [{ userId: { in: ids } }, { linkedUserIds: { hasSome: ids } }],
    },
  });
  if (flags > 0) reasons.push("self-referral flag open or confirmed");
  return reasons;
}

/**
 * Moves one PENDING earning into the wallet: status AVAILABLE + EARNING_AVAILABLE
 * ledger entry. The status change is a conditional claim (still PENDING), so a
 * row voided or held concurrently since it was read is skipped: returns false.
 */
export async function makeEarningAvailable(
  tx: WalletTx & Pick<DbTransaction, "programEarning">,
  earning: { id: string; beneficiaryUserId: string; amountMinor: number },
  at: Date = new Date(),
): Promise<boolean> {
  const locked = await lockProgramWallet(tx, earning.beneficiaryUserId);
  const claimed = await tx.programEarning.updateMany({
    where: { id: earning.id, status: "PENDING" },
    data: { status: "AVAILABLE", availableAt: at, holdReason: null },
  });
  if (claimed.count !== 1) return false;
  await moveProgramWallet(
    tx,
    earning.beneficiaryUserId,
    locked,
    { availableMinor: earning.amountMinor },
    {
      kind: "EARNING_AVAILABLE",
      refType: "ProgramEarning",
      refId: earning.id,
    },
  );
  return true;
}

// ---------- eligibility ----------

interface ActorFacts {
  status: string;
  role: string;
  legacySimulated: boolean;
  kycStatus: KycStatus;
  affiliateProfile: { status: AffiliateStatus } | null;
}

export const isProgramAffiliate = (u: Pick<ActorFacts, "role" | "legacySimulated">) => u.role === "AFFILIATE" && !u.legacySimulated;

/** Account-level refusals (amount-independent), in the order they are reported. */
export function programActionBlockers(u: ActorFacts, action: "transfer" | "withdraw", hasLiveAccount: boolean): ProgramRefusalCode[] {
  const out: ProgramRefusalCode[] = [];
  const affiliate = isProgramAffiliate(u);
  if (u.status === "FROZEN" || u.status === "BANNED" || u.legacySimulated) out.push("account_frozen");
  if (affiliate && u.affiliateProfile?.status !== "ACTIVE") out.push("affiliate_not_active");
  // Affiliates: KYC before any transfer or withdrawal (§3, §11). Regular users: before a withdrawal only.
  if ((affiliate || action === "withdraw") && u.kycStatus !== "VERIFIED") out.push("kyc_required");
  if (action === "transfer" && !hasLiveAccount) out.push("no_live_account");
  return out;
}

export const ACTOR_SELECT = {
  status: true,
  role: true,
  legacySimulated: true,
  kycStatus: true,
  affiliateProfile: { select: { status: true } },
} as const;

/** REQUESTED + APPROVED + PAID program withdrawals created in the current IST day / Mon–Sun week / month. */
export async function countProgramWithdrawalsUsed(
  userId: string,
  now: Date,
  client: Pick<DbTransaction, "programWithdrawal"> = prisma,
): Promise<{ day: number; week: number; month: number }> {
  const w = istLimitWindows(now);
  const from = new Date(Math.min(w.weekStart.getTime(), w.monthStart.getTime()));
  const rows = await client.programWithdrawal.findMany({
    where: {
      userId,
      status: { in: ["REQUESTED", "APPROVED", "PAID"] },
      createdAt: { gte: from },
    },
    select: { createdAt: true },
  });
  const since = (t: Date) => rows.filter((r) => r.createdAt.getTime() >= t.getTime()).length;
  return {
    day: since(w.dayStart),
    week: since(w.weekStart),
    month: since(w.monthStart),
  };
}

// ---------- read models ----------

export interface ProgramSummary {
  isAffiliate: boolean;
  affiliateStatus: AffiliateStatus | null;
  emailVerified: boolean;
  kycStatus: KycStatus;
  currency: "INR";
  pendingMinor: number;
  heldMinor: number;
  availableMinor: number;
  reservedMinor: number;
  transferredMinor: number;
  paidMinor: number;
  carryForwardMinor: number;
  totalReferrals: number;
  qualifiedUsers: number;
  totalDepositedMinor: number;
  terms: {
    userRewardMinor: number;
    affiliateDepositRewardBps: number;
    revenueShareBps: number;
    minQualifyingDepositMinor: number;
    minQualifyingTradeMinor: number;
    inviteExtraBonusPct: number;
    minWithdrawalMinor: number;
    limits: { day: number; week: number; month: number };
  };
  used: { day: number; week: number; month: number };
  canTransfer: boolean;
  canWithdraw: boolean;
  /** Union of transfer and withdrawal refusal codes that apply right now. */
  blockers: ProgramRefusalCode[];
}

export async function getProgramSummary(userId: string): Promise<ProgramSummary> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...ACTOR_SELECT,
      emailVerified: true,
      accounts: { where: { type: "LIVE" }, select: { id: true } },
    },
  });
  if (!user) throw new ProgramActionRefused("not_found");
  const affiliate = isProgramAffiliate(user);

  const [sums, wallet, carry, totalReferrals, qualified, values, rate, used] = await Promise.all([
    prisma.programEarning.groupBy({
      by: ["status"],
      where: {
        beneficiaryUserId: userId,
        status: { in: ["PENDING", "HELD"] },
      },
      _sum: { amountMinor: true },
    }),
    prisma.programWallet.findUnique({ where: { userId } }),
    prisma.revenueShareDay.findFirst({
      where: { affiliateId: userId },
      orderBy: { day: "desc" },
      select: { carryOutMinor: true },
    }),
    prisma.user.count({ where: { referredById: userId } }),
    prisma.referralQualification.findMany({
      where: { inviterId: userId, status: "QUALIFIED" },
      select: { referredUserId: true },
    }),
    programSettingValuesAt(now),
    affiliate ? getAffiliateRateAt(userId, now) : Promise.resolve(null),
    countProgramWithdrawalsUsed(userId, now),
  ]);
  const deposits = qualified.length
    ? await prisma.deposit.findMany({
        where: {
          userId: { in: qualified.map((q) => q.referredUserId) },
          status: "COMPLETED",
        },
        select: {
          method: true,
          amountInr: true,
          amountUsd: true,
          amountUsdtMinor: true,
          requestedInrMinor: true,
        },
      })
    : [];
  let totalDepositedMinor = 0;
  for (const d of deposits) {
    try {
      totalDepositedMinor += qualifyingDepositInrMinor(d);
    } catch {
      // a row whose value can't be determined counts as 0 (never overstate)
    }
  }

  const sumOf = (s: "PENDING" | "HELD") => sums.find((r) => r.status === s)?._sum.amountMinor ?? 0;
  const availableMinor = wallet?.availableMinor ?? 0;
  const rules = withdrawalRules(values);
  const hasLive = user.accounts.length > 0;
  const transferBlockers = programActionBlockers(user, "transfer", hasLive);
  const withdrawBlockers = programActionBlockers(user, "withdraw", hasLive);
  if (availableMinor < rules.minWithdrawalMinor) withdrawBlockers.push(availableMinor > 0 ? "below_minimum" : "insufficient_funds");
  if (availableMinor <= 0) transferBlockers.push("insufficient_funds");
  if (used.day >= rules.limits.day) withdrawBlockers.push("limit_day");
  if (used.week >= rules.limits.week) withdrawBlockers.push("limit_week");
  if (used.month >= rules.limits.month) withdrawBlockers.push("limit_month");

  return {
    isAffiliate: affiliate,
    affiliateStatus: user.affiliateProfile?.status ?? null,
    emailVerified: user.emailVerified,
    kycStatus: user.kycStatus,
    currency: "INR",
    pendingMinor: sumOf("PENDING"),
    heldMinor: sumOf("HELD"),
    availableMinor,
    reservedMinor: wallet?.reservedMinor ?? 0,
    transferredMinor: wallet?.transferredMinor ?? 0,
    paidMinor: wallet?.paidMinor ?? 0,
    carryForwardMinor: carry?.carryOutMinor ?? 0,
    totalReferrals,
    qualifiedUsers: qualified.length,
    totalDepositedMinor,
    terms: {
      userRewardMinor: required(values, "USER_REFERRAL_REWARD_INR_MINOR"),
      affiliateDepositRewardBps: rate?.depositRewardBps ?? required(values, "AFFILIATE_DEPOSIT_REWARD_BPS"),
      revenueShareBps: rate?.revenueShareBps ?? 0,
      minQualifyingDepositMinor: required(values, "MIN_QUALIFYING_DEPOSIT_INR_MINOR"),
      minQualifyingTradeMinor: required(values, "MIN_QUALIFYING_TRADE_INR_MINOR"),
      inviteExtraBonusPct: required(values, "INVITE_EXTRA_BONUS_PCT"),
      ...rules,
    },
    used,
    canTransfer: transferBlockers.length === 0,
    canWithdraw: withdrawBlockers.length === 0,
    blockers: [...new Set([...transferBlockers, ...withdrawBlockers])],
  };
}

export interface ProgramActivityItem {
  id: string;
  date: Date;
  type: "EARNING" | "TRANSFER" | "WITHDRAWAL";
  /** Earning kind (REFERRAL_REWARD, …), "TRANSFER", or "WITHDRAWAL". */
  kind: string;
  amountMinor: number;
  status: string;
  method: string | null;
  reason: string | null;
}

/** Newest first: earnings (by earnedAt), transfers and withdrawals (by createdAt), strictly before `before`. */
export async function listProgramActivity(userId: string, opts: { limit: number; before?: Date }): Promise<ProgramActivityItem[]> {
  const take = Math.min(Math.max(Math.trunc(opts.limit) || 1, 1), 100);
  const before = opts.before ?? new Date(8.64e15);
  const [earnings, transfers, withdrawals] = await Promise.all([
    prisma.programEarning.findMany({
      where: { beneficiaryUserId: userId, earnedAt: { lt: before } },
      orderBy: { earnedAt: "desc" },
      take,
    }),
    prisma.programTransfer.findMany({
      where: { userId, createdAt: { lt: before } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.programWithdrawal.findMany({
      where: { userId, createdAt: { lt: before } },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);
  const items: ProgramActivityItem[] = [
    ...earnings.map((e) => ({
      id: e.id,
      date: e.earnedAt,
      type: "EARNING" as const,
      kind: e.kind,
      amountMinor: e.amountMinor,
      status: e.status,
      method: null,
      reason: null, // §13: hold/void reasons name other users and fraud checks; never shown to the owner
    })),
    ...transfers.map((t) => ({
      id: t.id,
      date: t.createdAt,
      type: "TRANSFER" as const,
      kind: "TRANSFER",
      amountMinor: t.amountMinor,
      status: "COMPLETED",
      method: "TRADING_ACCOUNT",
      reason: null,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      date: w.createdAt,
      type: "WITHDRAWAL" as const,
      kind: "WITHDRAWAL",
      amountMinor: w.amountMinor,
      status: w.status,
      method: w.method,
      reason: w.status === "REJECTED" ? w.reason : null, // only the user-facing rejection reason
    })),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id)).slice(0, take);
}

// ---------- admin adjustment ----------

/**
 * Admin correction (±) applied to available at once: an AVAILABLE ADJUSTMENT
 * earning (for history), its ADJUSTMENT ledger entry and an AuditLog row. A
 * negative amount larger than available is refused (never below 0).
 * `idempotencyKey` (a UUID, one per rendered admin form) becomes the earning id,
 * so a double submit applies once and the retry returns the original result.
 */
export async function createProgramAdjustment(input: {
  userId: string;
  amountMinor: number;
  reason: string;
  actor: string;
  idempotencyKey: string;
}): Promise<{ earningId: string; availableMinor: number }> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) throw new ProgramActionRefused("invalid_amount");
  if (!UUID_RE.test(input.idempotencyKey)) throw new ProgramActionRefused("invalid_state", "Invalid idempotency key.");
  const original = async (client: Pick<DbTransaction, "programEarning" | "programLedgerEntry">) => {
    const e = await client.programEarning.findUnique({
      where: { id: input.idempotencyKey },
    });
    if (!e) return null;
    if (e.kind !== "ADJUSTMENT" || e.beneficiaryUserId !== input.userId || e.amountMinor !== input.amountMinor) {
      throw new ProgramActionRefused("invalid_state", "Idempotency key already used.");
    }
    const entry = await client.programLedgerEntry.findUniqueOrThrow({
      where: {
        kind_refType_refId: {
          kind: "ADJUSTMENT",
          refType: "ProgramEarning",
          refId: e.id,
        },
      },
    });
    return { earningId: e.id, availableMinor: entry.availableAfter };
  };
  const prior = await original(prisma);
  if (prior) return prior;
  const reason = input.reason.trim();
  if (!reason) throw new ProgramActionRefused("invalid_state", "A reason is required.");
  const exists = await prisma.user.count({ where: { id: input.userId } });
  if (!exists) throw new ProgramActionRefused("not_found");
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockProgramWallet(tx, input.userId);
      const again = await original(tx); // a concurrent double submit waited on the lock
      if (again) return again;
      if (locked.availableMinor + input.amountMinor < 0) throw new ProgramActionRefused("insufficient_funds");
      const now = new Date();
      const e = await tx.programEarning.create({
        data: {
          id: input.idempotencyKey,
          beneficiaryUserId: input.userId,
          kind: "ADJUSTMENT",
          amountMinor: input.amountMinor,
          status: "AVAILABLE",
          earnedAt: now,
          availableAt: now,
          createdBy: input.actor,
          note: reason,
        },
      });
      const after = await moveProgramWallet(
        tx,
        input.userId,
        locked,
        { availableMinor: input.amountMinor },
        {
          kind: "ADJUSTMENT",
          refType: "ProgramEarning",
          refId: e.id,
          createdBy: input.actor,
          note: reason,
        },
      );
      await tx.auditLog.create({
        data: {
          actorId: input.actor,
          action: "program.adjustment",
          targetType: "User",
          targetId: input.userId,
          before: { availableMinor: locked.availableMinor },
          after: {
            availableMinor: after.availableMinor,
            amountMinor: input.amountMinor,
            earningId: e.id,
            reason,
          },
        },
      });
      return { earningId: e.id, availableMinor: after.availableMinor };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await original(prisma);
      if (again) return again;
    }
    throw err;
  }
}
