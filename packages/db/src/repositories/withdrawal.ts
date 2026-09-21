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
 */
export async function requestWithdrawal(input: {
  actorId: string;
  accountId: string;
  amount: number;
  method: string;
}): Promise<Withdrawal> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new WithdrawalRefused("Enter a valid amount.");
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

        const withdrawal = await tx.withdrawal.create({
          data: {
            userId: input.actorId,
            amount: input.amount,
            method: input.method,
            status: "REQUESTED",
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
