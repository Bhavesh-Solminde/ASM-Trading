import { randomBytes } from "node:crypto";
import { prisma } from "../client";
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
  amountUsdMinor: number;
  correlationId: string;
}): Promise<Deposit> {
  if (input.amountUsdMinor < MIN_DEPOSIT_USD_MINOR) {
    throw new Error(
      `Below the minimum deposit of $${(MIN_DEPOSIT_USD_MINOR / 100).toFixed(2)}.`,
    );
  }
  if (input.amountUsdMinor > MAX_DEPOSIT_USD_MINOR) {
    throw new Error(
      `Above the maximum deposit of $${(MAX_DEPOSIT_USD_MINOR / 100).toFixed(2)}.`,
    );
  }

  const baseInr = Math.round(input.amountUsdMinor * USD_TO_INR_RATE);
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
          amountUsd: input.amountUsdMinor,
          amountInr,
          vpa: DEMO_VPA,
          checkoutToken: randomBytes(24).toString("base64url"),
          status: "AWAITING_PAYMENT",
          correlationId: input.correlationId,
          expiresAt,
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
export async function claimUtr(actorId: string, depositId: string, utr: string): Promise<Deposit> {
  const claimed = await prisma.deposit.updateMany({
    where: {
      id: depositId,
      userId: actorId,
      status: "AWAITING_PAYMENT",
      claimedUtr: null,
    },
    data: { claimedUtr: utr, status: "PENDING_CONFIRMATION" },
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

  const bonus = Math.floor((deposit.amountUsd * BONUS_PERCENT) / 100);

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
        realBalance: { increment: deposit.amountUsd },
        bonusBalance: { increment: bonus },
        version: { increment: 1 },
      },
    });

    await tx.transaction.create({
      data: {
        accountId: account.id,
        kind: "DEPOSIT",
        amount: deposit.amountUsd,
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
      data: { cumulativeDeposits: { increment: deposit.amountUsd } },
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
}
