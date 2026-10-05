import { prisma } from "../client";
import type { Withdrawal } from "../../generated/prisma/client";

export class WithdrawalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalRefused";
  }
}

/** Thrown inside the debit transaction to roll it back for a retry. Never escapes. */
class VersionConflict extends Error {}

const MAX_ATTEMPTS = 5;

/**
 * Positive-integer env parse with a hard default. We don't want a typo in
 * `WITHDRAWAL_HOLD_HOURS=on` to silently disable the hold — any non-positive
 * value falls back to the default rather than taking its value literally.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * How long a first-withdrawal hold sits before auto-promoting to REQUESTED.
 * Default 36 hours — long enough to break the "deposit, win once, cash out"
 * burst without inconveniencing a committed user.
 */
export const WITHDRAWAL_HOLD_HOURS = readPositiveIntEnv("WITHDRAWAL_HOLD_HOURS", 36);

/**
 * How long the user may cancel a HELD withdrawal and get the money back into
 * their realBalance. Must be < WITHDRAWAL_HOLD_HOURS so the admin never sees
 * a request that is still cancelable. Default 12 hours.
 */
export const WITHDRAWAL_CANCEL_WINDOW_HOURS = readPositiveIntEnv(
  "WITHDRAWAL_CANCEL_WINDOW_HOURS",
  12,
);

/**
 * A withdrawal qualifies for the hold only when placed within this many hours
 * of the user's first-ever COMPLETED deposit. After this window the user has
 * demonstrated enough commitment that the hold is counter-productive. Default
 * 48 hours.
 */
export const FIRST_WITHDRAWAL_WINDOW_HOURS = readPositiveIntEnv(
  "FIRST_WITHDRAWAL_WINDOW_HOURS",
  48,
);

/**
 * Only the real balance is withdrawable. The 100% first-deposit bonus — and
 * anything won while staking it, which settles back into the bonus balance —
 * is sticky: it exists to trade with and can never be cashed out. So the
 * withdrawable amount is exactly `realBalance`, and the whole `bonusBalance`
 * is reported as locked. (`turnoverRemaining` is kept in the shape for callers
 * but is always 0 now that bonus never releases.)
 */
export async function withdrawableBalance(accountId: string): Promise<{
  withdrawable: number;
  lockedBonus: number;
  turnoverRemaining: number;
}> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { realBalance: true, bonusBalance: true },
  });

  return {
    withdrawable: account.realBalance,
    lockedBonus: account.bonusBalance,
    turnoverRemaining: 0,
  };
}

/**
 * Withdrawals go only to a method already used for a COMPLETED deposit, which
 * is the rule the original states and a standard anti-laundering control.
 *
 * The debit is optimistic-concurrency guarded exactly like a trade stake: the
 * balance is re-read and version-checked inside the transaction, so two
 * simultaneous withdrawals cannot both spend the same money. Real balance is
 * drawn before released bonus, and one ledger row records the movement.
 *
 * First-withdrawal hold (2026-10-06): if this is the user's first-ever
 * Withdrawal row AND it is placed within FIRST_WITHDRAWAL_WINDOW_HOURS of
 * their first-ever COMPLETED deposit, the request lands as HELD (with
 * holdUntil/cancelableUntil set), funds are still debited, and the user may
 * cancel it within the cancel window. Otherwise it is REQUESTED as before.
 */
export async function requestWithdrawal(input: {
  actorId: string;
  accountId: string;
  amount: number;
  method: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<Withdrawal> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new WithdrawalRefused("Enter a valid amount.");
  }

  // The status gate belongs upstream of the balance read: a FROZEN or BANNED
  // user should not learn how much they had, and the refusal message is
  // deliberately vague so a suspended abuser can't map out which check tripped.
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: input.actorId },
    select: { status: true },
  });
  if (actor.status !== "ACTIVE") {
    throw new WithdrawalRefused(
      "Withdrawals are paused on this account. Contact support.",
    );
  }

  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: input.actorId },
  });
  if (!account) throw new WithdrawalRefused("Account not found.");
  if (account.type !== "LIVE") {
    throw new WithdrawalRefused("Demo funds cannot be withdrawn.");
  }

  const usedMethod = await prisma.deposit.findFirst({
    where: { userId: input.actorId, method: input.method, status: "COMPLETED" },
  });
  if (!usedMethod) {
    throw new WithdrawalRefused(
      "You can only withdraw to a method you have already deposited with.",
    );
  }

  // Cross-user method dedup: a payment method (UPI ID / card / bank rail
  // identifier) that has ever completed a deposit or withdrawal for a
  // DIFFERENT user is a laundering / hedging enabler and is refused. Same-user
  // history is fine — that is exactly what the check above requires. We look
  // at both Deposit and Withdrawal so a colluding pair can't pass by opening
  // the loop from either direction.
  const foreignDeposit = await prisma.deposit.findFirst({
    where: {
      method: input.method,
      status: "COMPLETED",
      userId: { not: input.actorId },
    },
    select: { id: true },
  });
  const foreignWithdrawal = await prisma.withdrawal.findFirst({
    where: {
      method: input.method,
      userId: { not: input.actorId },
      // Anything past REQUESTED means the operator or the bank has already
      // touched it — refuse. A stale REQUESTED (never reviewed) is not enough
      // signal on its own.
      status: { in: ["APPROVED", "PAID"] },
    },
    select: { id: true },
  });
  if (foreignDeposit || foreignWithdrawal) {
    throw new WithdrawalRefused(
      "This payment method is registered to another account. Contact support.",
    );
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const fresh = await tx.account.findUniqueOrThrow({
          where: { id: input.accountId },
          select: { realBalance: true, bonusBalance: true, version: true },
        });

        // Only real balance is withdrawable; the bonus is sticky and is never
        // debited by a withdrawal. Re-read inside the transaction so the
        // ceiling reflects the balance we are about to debit, not a stale read.
        if (input.amount > fresh.realBalance) {
          throw new WithdrawalRefused(
            "That is more than your withdrawable balance. Bonus funds can't be withdrawn.",
          );
        }

        const claimed = await tx.account.updateMany({
          where: { id: input.accountId, version: fresh.version },
          data: {
            realBalance: { decrement: input.amount },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new VersionConflict();

        // Hold-eligibility check inside the transaction: count prior
        // withdrawals (any status, including HELD/CANCELLED/REJECTED) under
        // the same version-bumped lock so two concurrent first-withdrawal
        // requests cannot both pass the "first ever" test. If this is the
        // first row AND the user's first completed deposit was recent,
        // promote the status to HELD and stamp the two timestamps.
        const priorCount = await tx.withdrawal.count({ where: { userId: input.actorId } });
        let holdFields: { status: "HELD"; holdUntil: Date; cancelableUntil: Date } | null = null;
        if (priorCount === 0) {
          const firstDeposit = await tx.deposit.findFirst({
            where: { userId: input.actorId, status: "COMPLETED" },
            // Deposit has no completedAt — updatedAt is set the moment the
            // row flipped to COMPLETED (every completion path writes once;
            // the row isn't touched again except for a reversal, which is
            // itself an admin-only reset of history). Ordering by updatedAt
            // asc gets the first-ever completion.
            orderBy: { updatedAt: "asc" },
            select: { updatedAt: true },
          });
          if (firstDeposit) {
            const now = Date.now();
            const windowMs = FIRST_WITHDRAWAL_WINDOW_HOURS * 60 * 60 * 1000;
            if (now - firstDeposit.updatedAt.getTime() <= windowMs) {
              holdFields = {
                status: "HELD",
                holdUntil: new Date(now + WITHDRAWAL_HOLD_HOURS * 60 * 60 * 1000),
                cancelableUntil: new Date(
                  now + WITHDRAWAL_CANCEL_WINDOW_HOURS * 60 * 60 * 1000,
                ),
              };
            }
          }
        }

        const withdrawal = await tx.withdrawal.create({
          data: {
            userId: input.actorId,
            amount: input.amount,
            method: input.method,
            status: holdFields?.status ?? "REQUESTED",
            holdUntil: holdFields?.holdUntil ?? null,
            cancelableUntil: holdFields?.cancelableUntil ?? null,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
          },
        });

        await tx.transaction.create({
          data: {
            accountId: input.accountId,
            kind: "WITHDRAWAL",
            amount: -input.amount,
            balanceAfter: fresh.realBalance + fresh.bonusBalance - input.amount,
            refType: "Withdrawal",
            refId: withdrawal.id,
          },
        });

        return withdrawal;
      });
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }

  throw new WithdrawalRefused("Too many concurrent balance changes. Try again.");
}

/**
 * User-initiated cancel of a HELD withdrawal. Refunds the money to realBalance
 * and sets status=CANCELLED_BY_USER. Must be called within the row's cancel
 * window; the cancelableUntil check is repeated inside the transaction so two
 * concurrent cancels cannot both credit the money back.
 */
export async function cancelHeldWithdrawal(input: {
  actorId: string;
  withdrawalId: string;
}): Promise<Withdrawal> {
  const row = await prisma.withdrawal.findUnique({
    where: { id: input.withdrawalId },
    select: {
      id: true,
      userId: true,
      amount: true,
      status: true,
      cancelableUntil: true,
    },
  });
  if (!row || row.userId !== input.actorId) {
    throw new WithdrawalRefused("Withdrawal not found.");
  }
  if (row.status !== "HELD") {
    throw new WithdrawalRefused("This withdrawal can no longer be cancelled.");
  }
  if (!row.cancelableUntil || row.cancelableUntil.getTime() <= Date.now()) {
    throw new WithdrawalRefused("The cancel window has passed.");
  }

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: input.actorId, type: "LIVE" },
    select: { id: true },
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Re-check status + cancel window INSIDE the transaction so two
        // concurrent cancel requests can't both credit the money back —
        // whichever runs second sees the already-updated row.
        const claimedWithdrawal = await tx.withdrawal.updateMany({
          where: {
            id: input.withdrawalId,
            userId: input.actorId,
            status: "HELD",
            cancelableUntil: { gt: new Date() },
          },
          data: { status: "CANCELLED_BY_USER" },
        });
        if (claimedWithdrawal.count !== 1) {
          throw new WithdrawalRefused("This withdrawal can no longer be cancelled.");
        }

        const fresh = await tx.account.findUniqueOrThrow({
          where: { id: account.id },
          select: { realBalance: true, bonusBalance: true, version: true },
        });

        const claimedAccount = await tx.account.updateMany({
          where: { id: account.id, version: fresh.version },
          data: {
            realBalance: { increment: row.amount },
            version: { increment: 1 },
          },
        });
        if (claimedAccount.count !== 1) throw new VersionConflict();

        await tx.transaction.create({
          data: {
            accountId: account.id,
            kind: "WITHDRAWAL",
            amount: row.amount,
            balanceAfter: fresh.realBalance + fresh.bonusBalance + row.amount,
            refType: "Withdrawal",
            refId: row.id,
          },
        });

        return tx.withdrawal.findUniqueOrThrow({ where: { id: row.id } });
      });
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }

  throw new WithdrawalRefused("Too many concurrent balance changes. Try again.");
}

/**
 * Flips every HELD withdrawal whose holdUntil has passed to REQUESTED, so the
 * normal admin review path picks them up. One SQL UPDATE per tick — safe to
 * call every minute from the engine's loop or a scheduler. Returns the number
 * of rows promoted.
 */
export async function autoPromoteHeldWithdrawals(now: Date = new Date()): Promise<number> {
  const claimed = await prisma.withdrawal.updateMany({
    where: { status: "HELD", holdUntil: { lte: now } },
    data: { status: "REQUESTED" },
  });
  return claimed.count;
}

/**
 * Admin "force-release now" on a HELD withdrawal: flip HELD → REQUESTED
 * immediately, bypassing holdUntil. Writes an audit entry so the operator's
 * override is traceable. No funds move (the hold already had them debited).
 */
export async function releaseHeldWithdrawal(input: {
  withdrawalId: string;
  adminId: string;
}): Promise<void> {
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: input.withdrawalId, status: "HELD" },
    data: { status: "REQUESTED" },
  });
  if (claimed.count !== 1) {
    throw new WithdrawalRefused("That withdrawal is no longer on hold.");
  }

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "withdrawal.hold_released",
      targetType: "Withdrawal",
      targetId: input.withdrawalId,
      after: { status: "REQUESTED" },
    },
  });
}

/**
 * Admin reject of a withdrawal. Works on REQUESTED and on HELD (the spec
 * explicitly allows reject-while-held). Refunds the money, writes a ledger
 * row, and sets status=REJECTED. Idempotent via the status guard.
 */
export async function rejectWithdrawal(input: {
  withdrawalId: string;
  adminId: string;
  reason?: string;
}): Promise<void> {
  const row = await prisma.withdrawal.findUnique({
    where: { id: input.withdrawalId },
    select: { id: true, userId: true, amount: true, status: true },
  });
  if (!row) throw new WithdrawalRefused("Withdrawal not found.");
  if (row.status !== "REQUESTED" && row.status !== "HELD") {
    throw new WithdrawalRefused("That withdrawal has already been reviewed.");
  }

  const account = await prisma.account.findFirstOrThrow({
    where: { userId: row.userId, type: "LIVE" },
    select: { id: true },
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.withdrawal.updateMany({
          where: { id: row.id, status: { in: ["REQUESTED", "HELD"] } },
          data: { status: "REJECTED", reviewedBy: input.adminId, reason: input.reason ?? null },
        });
        if (claimed.count !== 1) {
          throw new WithdrawalRefused("That withdrawal has already been reviewed.");
        }

        const fresh = await tx.account.findUniqueOrThrow({
          where: { id: account.id },
          select: { realBalance: true, bonusBalance: true, version: true },
        });

        const bumped = await tx.account.updateMany({
          where: { id: account.id, version: fresh.version },
          data: {
            realBalance: { increment: row.amount },
            version: { increment: 1 },
          },
        });
        if (bumped.count !== 1) throw new VersionConflict();

        await tx.transaction.create({
          data: {
            accountId: account.id,
            kind: "WITHDRAWAL",
            amount: row.amount,
            balanceAfter: fresh.realBalance + fresh.bonusBalance + row.amount,
            refType: "Withdrawal",
            refId: row.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorId: input.adminId,
            action: "withdrawal.rejected",
            targetType: "Withdrawal",
            targetId: row.id,
            after: { status: "REJECTED", reason: input.reason ?? null },
          },
        });
      });
      return;
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }

  throw new WithdrawalRefused("Too many concurrent balance changes. Try again.");
}

/**
 * Marks a REQUESTED withdrawal APPROVED. The money already left the account at
 * request time, so this only records the operator's decision; the status guard
 * makes it idempotent.
 */
export async function approveWithdrawal(input: {
  withdrawalId: string;
  adminId: string;
}): Promise<void> {
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: input.withdrawalId, status: "REQUESTED" },
    data: { status: "APPROVED", reviewedBy: input.adminId },
  });
  if (claimed.count !== 1) {
    throw new WithdrawalRefused("That withdrawal has already been reviewed.");
  }

  await prisma.auditLog.create({
    data: {
      actorId: input.adminId,
      action: "withdrawal.approved",
      targetType: "Withdrawal",
      targetId: input.withdrawalId,
      after: { status: "APPROVED" },
    },
  });
}

export async function listWithdrawalsForActor(
  actorId: string,
  limit: number,
): Promise<Withdrawal[]> {
  return prisma.withdrawal.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
