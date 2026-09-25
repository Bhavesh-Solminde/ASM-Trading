import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import { flagLinkageForUser } from "./fraud";
import type { Deposit } from "../../generated/prisma/client";

/**
 * The PSP-style conversion rate. Deliberately above interbank — that spread is
 * the margin the real processors take before a customer has traded anything.
 */
export const USD_TO_INR_RATE = 107.64;

/**
 * The offset window is symmetric around the converted base amount: from
 * OFFSET_LOW to OFFSET_LOW + OFFSET_SPACE - 1 paise, i.e. -999 to +1000 for
 * the current values — roughly ±₹10, ~2,000 distinct slots. This is the pool
 * of possible unique amounts, NOT a tolerance applied at match time: matching
 * is always exact against whichever single value was actually reserved.
 */
export const OFFSET_LOW = -999;
export const OFFSET_SPACE = 2000;

export const DEPOSIT_TTL_MINUTES = 60;
export const MIN_DEPOSIT_USD_MINOR = 1_000; // $10.00
export const MAX_DEPOSIT_USD_MINOR = 96_100; // $961.00
// Deposits are collected in rupees over UPI. Paise (minor units).
export const MIN_DEPOSIT_INR_MINOR = 100_000; // ₹1,000.00
export const MAX_DEPOSIT_INR_MINOR = 100_000_000; // ₹10,00,000.00

/**
 * VPA no longer participates in matching (amount is the sole reconciliation
 * key — see the design doc), so every deposit uses one fixed demo collection
 * identity. It still matters for the QR/UPI deep link, which routes real
 * payment traffic to this address.
 */
export const DEMO_VPA = "7977304892@axl";

export class AmountSpaceExhausted extends Error {
  constructor() {
    super("No deposit slot is free right now. Try again in a few minutes.");
    this.name = "AmountSpaceExhausted";
  }
}

export class DepositNotFound extends Error {
  constructor() {
    super("Deposit not found.");
    this.name = "DepositNotFound";
  }
}

export class DepositAlreadyResolved extends Error {
  constructor() {
    super("This deposit has already been resolved.");
    this.name = "DepositAlreadyResolved";
  }
}

export class UtrAlreadyClaimed extends Error {
  constructor() {
    super("A reference has already been submitted for this deposit.");
    this.name = "UtrAlreadyClaimed";
  }
}

/**
 * Creates a deposit intent with a RESERVED amount, unique among all
 * currently-live deposits regardless of VPA.
 *
 * A UTR proves nothing on its own — anyone can type any number, and for a
 * relayed SMS there is often no UTR to check at all. But if ₹10,764.37 is
 * reserved to exactly one live deposit, a credit of exactly that amount can
 * only belong to that deposit. The amount is the identifier, which is why
 * it's an odd number rather than the round figure the user asked for.
 *
 * Uniqueness is enforced by a partial unique index (Task 1's migration), so
 * two concurrent requests cannot be handed the same amount. We retry on
 * collision rather than locking, starting from a random offset so concurrent
 * callers don't all probe the same slot first.
 */
export async function createDepositIntent(input: {
  userId: string;
  method: string;
  amountInrMinor: number;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<Deposit> {
  if (input.amountInrMinor < MIN_DEPOSIT_INR_MINOR) {
    throw new Error(
      `Below the minimum deposit of ₹${(MIN_DEPOSIT_INR_MINOR / 100).toLocaleString("en-IN")}.`,
    );
  }
  if (input.amountInrMinor > MAX_DEPOSIT_INR_MINOR) {
    throw new Error(
      `Above the maximum deposit of ₹${(MAX_DEPOSIT_INR_MINOR / 100).toLocaleString("en-IN")}.`,
    );
  }

  // The user enters rupees; that is the amount reserved and, for an INR
  // account, credited. The USD figure is kept for the record only.
  const baseInr = input.amountInrMinor;
  const amountUsd = Math.round(input.amountInrMinor / USD_TO_INR_RATE);
  const expiresAt = new Date(Date.now() + DEPOSIT_TTL_MINUTES * 60_000);

  const start = randomBytes(2).readUInt16BE(0) % OFFSET_SPACE;

  for (let probe = 0; probe < OFFSET_SPACE; probe++) {
    const offset = OFFSET_LOW + ((start + probe) % OFFSET_SPACE);
    const amountInr = baseInr + offset;

    try {
      return await prisma.deposit.create({
        data: {
          userId: input.userId,
          method: input.method,
          amountUsd,
          amountInr,
          vpa: DEMO_VPA,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") continue;
      throw err;
    }
  }

  throw new AmountSpaceExhausted();
}

/** All live (not yet resolved) deposits that reserved exactly this amount. In
 * practice this is 0 or 1 rows — the partial unique index guarantees at most
 * one — but the caller (the matcher) treats more than one as a bug to flag,
 * not something to silently pick between. */
export async function findLiveDepositByAmount(amountInr: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: {
      amountInr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

export async function findLiveDepositByClaimedUtr(utr: string): Promise<Deposit | null> {
  return prisma.deposit.findFirst({
    where: {
      claimedUtr: utr,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
  });
}

/** One deposit by its opaque checkout token — the hosted checkout page's key. */
export async function getDepositByToken(token: string): Promise<Deposit | null> {
  return prisma.deposit.findUnique({ where: { checkoutToken: token } });
}

/**
 * Deposits a human confirmed (a UTR was entered) that the feed never credited —
 * the residue the admin queue exists for. Exact and amount-only matches are
 * approved automatically and never reach here.
 */
export async function listPendingDeposits(limit: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { status: "PENDING_CONFIRMATION" },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Rejects a live deposit. The Deposit model carries no reason column, so the
 * reason is recorded on the audit log only. Idempotent via the status guard.
 */
export async function rejectDeposit(input: {
  depositId: string;
  adminId: string;
  reason: string;
}): Promise<void> {
  const claimed = await prisma.deposit.updateMany({
    where: {
      id: input.depositId,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
    data: { status: "REJECTED" },
  });
  if (claimed.count !== 1) throw new DepositAlreadyResolved();

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "deposit.rejected",
      targetType: "Deposit",
      targetId: input.depositId,
      after: { status: "REJECTED", reason: input.reason },
    },
  });
}

/** A user's own deposits, newest first. Ownership is in the predicate. */
export async function listDepositsForActor(actorId: string, limit: number): Promise<Deposit[]> {
  return prisma.deposit.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}

/**
 * Records the user's self-declared reference and moves the deposit to
 * PENDING_CONFIRMATION, so the matcher's amount check is joined by a reference
 * tiebreaker. Ownership is enforced in the same UPDATE that claims the row: a
 * deposit belonging to another user, already resolved, or already claimed is
 * never touched, and the caller cannot tell an authz failure apart from a
 * genuinely missing row.
 */
export async function claimUtr(
  actorId: string,
  depositId: string,
  utr: string,
  screenshotUrl?: string,
): Promise<Deposit> {
  const claimed = await prisma.deposit.updateMany({
    where: {
      id: depositId,
      userId: actorId,
      status: "AWAITING_PAYMENT",
      claimedUtr: null,
    },
    data: {
      claimedUtr: utr,
      status: "PENDING_CONFIRMATION",
      ...(screenshotUrl ? { screenshotUrl } : {}),
    },
  });

  if (claimed.count !== 1) {
    // Distinguish "not yours / gone" (404) from "already claimed" (409) so the
    // checkout page can tell the user which happened.
    const existing = await prisma.deposit.findFirst({ where: { id: depositId, userId: actorId } });
    if (!existing) throw new DepositNotFound();
    throw new UtrAlreadyClaimed();
  }

  return prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
}

export const BONUS_PERCENT = 100;
export const TURNOVER_MULTIPLE = 3;

/**
 * Approves a deposit and credits the account, in one transaction so a crash
 * or a retry cannot double-credit. `creditId` may be null for a manually
 * approved deposit with no specific bank credit on record (e.g. an admin
 * override); when present, that credit is atomically marked consumed inside
 * the same transaction as the approval.
 */
export async function creditDepositToAccount(input: {
  depositId: string;
  adminId: string | null;
  creditId: string | null;
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });

  // Credit in the account's own currency: an INR rail is funded with the INR
  // amount, a USD rail with the USD amount. The deposit carries both figures.
  const credit = account.currency === "INR" ? deposit.amountInr : deposit.amountUsd;
  const bonus = Math.floor((credit * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.deposit.updateMany({
      where: {
        id: deposit.id,
        status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
      },
      data: { status: "COMPLETED", matchedCreditId: input.creditId },
    });
    if (claimed.count !== 1) throw new DepositAlreadyResolved();

    if (input.creditId) {
      const consumed = await tx.bankCredit.updateMany({
        where: { id: input.creditId, consumed: false },
        data: { consumed: true },
      });
      if (consumed.count !== 1) throw new DepositAlreadyResolved();
    }

    const updated = await tx.account.update({
      where: { id: account.id },
      data: {
        realBalance: { increment: credit },
        bonusBalance: { increment: bonus },
        version: { increment: 1 },
      },
    });

    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: credit,
        balanceAfter: updated.realBalance + updated.bonusBalance,
        refType: "Deposit",
        refId: deposit.id,
      },
    });

    if (bonus > 0) {
      await tx.bonusGrant.create({
        data: {
          accountId: account.id,
          amount: bonus,
          turnoverRequired: bonus * TURNOVER_MULTIPLE,
        },
      });
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "BONUS_GRANT",
          amount: bonus,
          balanceAfter: updated.realBalance + updated.bonusBalance,
          refType: "Deposit",
          refId: deposit.id,
        },
      });
    }

    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { increment: credit } },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: input.adminId ? "deposit.approved_manual" : "deposit.approved_auto",
        targetType: "Deposit",
        targetId: deposit.id,
        after: { status: "COMPLETED", creditId: input.creditId, bonus },
      },
    });
  });

  // The bonus grant is when the multi-account attack pays off — every account
  // gets one, so this is the moment to check whether the user just picked up
  // is one of many linked accounts. Run OUTSIDE the transaction: a detector
  // failure must never roll back a completed deposit, and the flag itself is
  // advisory (admin decides), not a hold on the credit.
  flagLinkageForUser({ userId: deposit.userId }).catch(() => {
    /* the detector logs its own failures via the prisma client */
  });
}

export class DepositReversalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositReversalRefused";
  }
}

/**
 * Reverses a COMPLETED deposit. This is the admin-only path for chargebacks,
 * confirmed fraud rulings, and duplicate-credit corrections. Not exposed to
 * the user's flow — a user cannot ever reverse their own deposit.
 *
 * Correctness invariants:
 *   1. cumulativeDeposits is decremented BY THE SAME `credit` VALUE that was
 *      added at approval, so lifecycle stage derives correctly on the next
 *      controller call. Without this, a refunded deposit leaves the user
 *      stuck in HIGH_VALUE with no matching money on file.
 *   2. Real and bonus balances are debited by exactly what was credited. If
 *      the user has already spent below what would need to be reclaimed and
 *      `force` is false, the reversal is REFUSED (admin decides whether to
 *      force-cap at zero or freeze the account and pursue recovery).
 *   3. The Deposit row is moved to REJECTED (no separate REVERSED status —
 *      that would be a schema migration; the audit log distinguishes the two).
 *   4. Any BankCredit that was consumed by this deposit stays consumed.
 *      Un-consuming would let the matcher re-fire against another live
 *      deposit for the same amount — a real risk of double-spend.
 */
export async function reverseCompletedDeposit(input: {
  depositId: string;
  adminId: string;
  reason: string;
  force?: boolean;
}): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: input.depositId } });
  if (!deposit) throw new DepositNotFound();
  if (deposit.status !== "COMPLETED") {
    throw new DepositReversalRefused(
      "Only a COMPLETED deposit can be reversed. Use rejectDeposit for pending ones.",
    );
  }

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: deposit.userId, type: "LIVE" },
  });
  const credit = account.currency === "INR" ? deposit.amountInr : deposit.amountUsd;
  const bonus = Math.floor((credit * BONUS_PERCENT) / 100);

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.account.findUniqueOrThrow({
      where: { id: account.id },
      select: { realBalance: true, bonusBalance: true, version: true },
    });

    const realCap = Math.min(credit, fresh.realBalance);
    const bonusCap = Math.min(bonus, fresh.bonusBalance);
    if (!input.force && (realCap < credit || bonusCap < bonus)) {
      throw new DepositReversalRefused(
        "The account balance is below the amount to be reclaimed. Pass force=true to cap at zero.",
      );
    }

    const claimedDeposit = await tx.deposit.updateMany({
      where: { id: deposit.id, status: "COMPLETED" },
      data: { status: "REJECTED" },
    });
    if (claimedDeposit.count !== 1) throw new DepositAlreadyResolved();

    const claimedAccount = await tx.account.updateMany({
      where: { id: account.id, version: fresh.version },
      data: {
        realBalance: { decrement: realCap },
        bonusBalance: { decrement: bonusCap },
        version: { increment: 1 },
      },
    });
    if (claimedAccount.count !== 1) {
      throw new DepositReversalRefused(
        "Balance changed while the reversal was being applied. Retry.",
      );
    }

    await tx.user.update({
      where: { id: deposit.userId },
      data: { cumulativeDeposits: { decrement: credit } },
    });

    const balanceAfter = fresh.realBalance + fresh.bonusBalance - realCap - bonusCap;
    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: -realCap,
        balanceAfter,
        refType: "Deposit",
        refId: deposit.id,
      },
    });
    if (bonusCap > 0) {
      await tx.transaction.create({
        data: {
          accountId: account.id,
          kind: "BONUS_CONVERT",
          amount: -bonusCap,
          balanceAfter,
          refType: "Deposit",
          refId: deposit.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "deposit.reversed",
        targetType: "Deposit",
        targetId: deposit.id,
        before: { status: "COMPLETED", credit, bonus },
        after: {
          status: "REJECTED",
          reason: input.reason,
          reclaimedReal: realCap,
          reclaimedBonus: bonusCap,
          shortfall: (credit - realCap) + (bonus - bonusCap),
        },
      },
    });
  });
}
