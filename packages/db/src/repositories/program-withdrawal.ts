import { payoutDestinationKey, type PayoutDetails } from "@asm/contracts";
import { prisma, type DbTransaction } from "../client";
import type { ProgramWithdrawalStatus } from "../../generated/prisma/client";
import type { ProgramWithdrawal } from "../models";
import {
  ACTOR_SELECT,
  ProgramActionRefused,
  countProgramWithdrawalsUsed,
  isUniqueViolation,
  lockProgramWallet,
  moveProgramWallet,
  programActionBlockers,
  programSettingValuesAt,
  withdrawalRules,
} from "./program-wallet";

// §12 program withdrawals: own queue and limits, separate from trading withdrawals.

function payoutColumns(p: PayoutDetails) {
  return {
    method: p.method,
    accountHolder: p.method === "BANK" ? p.accountHolder : null,
    accountNumber: p.method === "BANK" ? p.accountNumber : null,
    ifsc: p.method === "BANK" ? p.ifsc : null,
    upiId: p.method === "UPI" ? p.upiId : null,
    usdtNetwork: p.method === "USDT" ? p.usdtNetwork : null,
    usdtAddress: p.method === "USDT" ? p.usdtAddress : null,
    destinationKey: payoutDestinationKey(p),
  };
}

async function byKey(userId: string, idempotencyKey: string, amountMinor: number, payout: PayoutDetails): Promise<ProgramWithdrawal | null> {
  const w = await prisma.programWithdrawal.findUnique({ where: { idempotencyKey } });
  // Same key, different request: refuse rather than silently answer with the original.
  if (w && (w.userId !== userId || w.amountMinor !== amountMinor || w.destinationKey !== payoutDestinationKey(payout))) throw new ProgramActionRefused("invalid_state", "Idempotency key already used.");
  return w;
}

/**
 * Reserves `amountMinor` of available money for a payout (available −= X,
 * reserved += X). `payout` must already be validated by PayoutDetailsSchema.
 * Limits count REQUESTED + APPROVED + PAID in the IST day / Mon–Sun week /
 * calendar month, read under the wallet lock so concurrent requests can't both
 * pass. A retry with the same idempotencyKey returns the original row.
 */
export async function requestProgramWithdrawal(input: {
  userId: string;
  amountMinor: number;
  payout: PayoutDetails;
  idempotencyKey: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<ProgramWithdrawal> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new ProgramActionRefused("invalid_amount");
  const prior = await byKey(input.userId, input.idempotencyKey, input.amountMinor, input.payout);
  if (prior) return prior;

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockProgramWallet(tx, input.userId);
      const now = new Date();
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: ACTOR_SELECT });
      if (!user) throw new ProgramActionRefused("not_found");
      const blockers = programActionBlockers(user, "withdraw", true);
      if (blockers[0]) throw new ProgramActionRefused(blockers[0]);

      const rules = withdrawalRules(await programSettingValuesAt(now, tx));
      if (input.amountMinor < rules.minWithdrawalMinor) throw new ProgramActionRefused("below_minimum");
      if (input.amountMinor > locked.availableMinor) throw new ProgramActionRefused("insufficient_funds");
      const used = await countProgramWithdrawalsUsed(input.userId, now, tx);
      if (used.day >= rules.limits.day) throw new ProgramActionRefused("limit_day");
      if (used.week >= rules.limits.week) throw new ProgramActionRefused("limit_week");
      if (used.month >= rules.limits.month) throw new ProgramActionRefused("limit_month");

      const w = await tx.programWithdrawal.create({
        data: {
          userId: input.userId,
          amountMinor: input.amountMinor,
          ...payoutColumns(input.payout),
          idempotencyKey: input.idempotencyKey,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          createdAt: now,
        },
      });
      await moveProgramWallet(tx, input.userId, locked, { availableMinor: -input.amountMinor, reservedMinor: input.amountMinor }, {
        kind: "WITHDRAWAL_RESERVE",
        refType: "ProgramWithdrawal",
        refId: w.id,
      });
      return w;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await byKey(input.userId, input.idempotencyKey, input.amountMinor, input.payout);
      if (again) return again;
    }
    throw err;
  }
}

type Tx = DbTransaction;

/**
 * Runs a status transition under the owner's wallet lock. `done` = the state a
 * retry of this same action leaves (returned unchanged); `from` = states it may
 * start from.
 */
async function transition(
  id: string,
  opts: { ownerId?: string; from: ProgramWithdrawalStatus[]; done: ProgramWithdrawalStatus },
  apply: (tx: Tx, w: ProgramWithdrawal, locked: Awaited<ReturnType<typeof lockProgramWallet>>) => Promise<ProgramWithdrawal>,
): Promise<ProgramWithdrawal> {
  const head = await prisma.programWithdrawal.findUnique({ where: { id }, select: { userId: true } });
  if (!head || (opts.ownerId !== undefined && head.userId !== opts.ownerId)) throw new ProgramActionRefused("not_found");
  return prisma.$transaction(async (tx) => {
    const locked = await lockProgramWallet(tx, head.userId);
    const w = await tx.programWithdrawal.findUniqueOrThrow({ where: { id } });
    if (w.status === opts.done) return w;
    if (!opts.from.includes(w.status)) throw new ProgramActionRefused("invalid_state", `Withdrawal is ${w.status}.`);
    return apply(tx, w, locked);
  });
}

async function release(tx: Tx, w: ProgramWithdrawal, locked: Awaited<ReturnType<typeof lockProgramWallet>>, createdBy: string | null, note: string | null) {
  await moveProgramWallet(tx, w.userId, locked, { availableMinor: w.amountMinor, reservedMinor: -w.amountMinor }, {
    kind: "WITHDRAWAL_RELEASE",
    refType: "ProgramWithdrawal",
    refId: w.id,
    createdBy,
    note,
  });
}

/** The owner cancels while REQUESTED: the reserved amount returns to available. */
export async function cancelProgramWithdrawal(input: { userId: string; withdrawalId: string }): Promise<ProgramWithdrawal> {
  return transition(input.withdrawalId, { ownerId: input.userId, from: ["REQUESTED"], done: "CANCELLED" }, async (tx, w, locked) => {
    await release(tx, w, locked, null, "cancelled by user");
    return tx.programWithdrawal.update({ where: { id: w.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  });
}

export async function listProgramWithdrawals(userId: string): Promise<ProgramWithdrawal[]> {
  return prisma.programWithdrawal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export const PROGRAM_WITHDRAWALS_PAGE_SIZE = 50;

export async function listProgramWithdrawalsForAdmin(input: { status?: ProgramWithdrawalStatus; page: number }): Promise<{
  rows: (ProgramWithdrawal & {
    user: { id: string; email: string; kycStatus: string; role: string };
    /** §15 review aid: OTHER users with a program or trading withdrawal to the same destination. */
    sharedDestinationUserCount: number;
  })[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, Math.trunc(input.page) || 1);
  const where = input.status ? { status: input.status } : {};
  const [rows, total] = await Promise.all([
    prisma.programWithdrawal.findMany({
      where,
      orderBy: { createdAt: input.status === "REQUESTED" || input.status === "APPROVED" ? "asc" : "desc" },
      skip: (page - 1) * PROGRAM_WITHDRAWALS_PAGE_SIZE,
      take: PROGRAM_WITHDRAWALS_PAGE_SIZE,
      include: { user: { select: { id: true, email: true, kycStatus: true, role: true } } },
    }),
    prisma.programWithdrawal.count({ where }),
  ]);
  const keys = [...new Set(rows.map((r) => r.destinationKey).filter((k): k is string => !!k))];
  const owners = keys.length
    ? await prisma.$queryRaw<{ k: string; u: string }[]>`
        SELECT "destinationKey" AS k, "userId" AS u FROM "ProgramWithdrawal" WHERE "destinationKey" = ANY(${keys})
        UNION
        SELECT "destinationKey" AS k, "userId" AS u FROM "Withdrawal" WHERE "destinationKey" = ANY(${keys})`
    : [];
  return {
    rows: rows.map((r) => ({
      ...r,
      sharedDestinationUserCount: r.destinationKey ? owners.filter((o) => o.k === r.destinationKey && o.u !== r.userId).length : 0,
    })),
    total,
    page,
    pageSize: PROGRAM_WITHDRAWALS_PAGE_SIZE,
  };
}

async function audit(tx: Tx, actor: string, action: string, w: ProgramWithdrawal, after: ProgramWithdrawal, extra: Record<string, string | null>) {
  await tx.auditLog.create({
    data: {
      actorId: actor,
      action,
      targetType: "ProgramWithdrawal",
      targetId: w.id,
      before: { status: w.status },
      after: { status: after.status, userId: w.userId, amountMinor: w.amountMinor, ...extra },
    },
  });
}

/** Approval alone is not payment: no money moves. */
export async function approveProgramWithdrawal(input: { id: string; actor: string; note?: string }): Promise<ProgramWithdrawal> {
  return transition(input.id, { from: ["REQUESTED"], done: "APPROVED" }, async (tx, w) => {
    const after = await tx.programWithdrawal.update({
      where: { id: w.id },
      data: { status: "APPROVED", approvedAt: new Date(), reviewedBy: input.actor },
    });
    await audit(tx, input.actor, "program.withdrawal.approve", w, after, { note: input.note?.trim() || null });
    return after;
  });
}

/** Reject while REQUESTED or APPROVED; the reason is shown to the user and the money returns to available. */
export async function rejectProgramWithdrawal(input: { id: string; actor: string; reason: string }): Promise<ProgramWithdrawal> {
  const reason = input.reason.trim();
  if (!reason) throw new ProgramActionRefused("invalid_state", "A reason is required.");
  return transition(input.id, { from: ["REQUESTED", "APPROVED"], done: "REJECTED" }, async (tx, w, locked) => {
    await release(tx, w, locked, input.actor, reason);
    const after = await tx.programWithdrawal.update({
      where: { id: w.id },
      data: { status: "REJECTED", rejectedAt: new Date(), reviewedBy: input.actor, reason },
    });
    await audit(tx, input.actor, "program.withdrawal.reject", w, after, { reason });
    return after;
  });
}

/** Only from APPROVED: reserved −= X, paid += X. */
export async function markProgramWithdrawalPaid(input: { id: string; actor: string; paymentReference: string }): Promise<ProgramWithdrawal> {
  const ref = input.paymentReference.trim();
  if (!ref) throw new ProgramActionRefused("invalid_state", "A payment reference is required.");
  return transition(input.id, { from: ["APPROVED"], done: "PAID" }, async (tx, w, locked) => {
    await moveProgramWallet(tx, w.userId, locked, { reservedMinor: -w.amountMinor, paidMinor: w.amountMinor }, {
      kind: "WITHDRAWAL_PAID",
      refType: "ProgramWithdrawal",
      refId: w.id,
      createdBy: input.actor,
      note: ref,
    });
    const after = await tx.programWithdrawal.update({
      where: { id: w.id },
      data: { status: "PAID", paidAt: new Date(), reviewedBy: input.actor, paymentReference: ref },
    });
    await audit(tx, input.actor, "program.withdrawal.paid", w, after, { paymentReference: ref });
    return after;
  });
}
