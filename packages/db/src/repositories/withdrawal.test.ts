import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  autoPromoteHeldWithdrawals,
  cancelHeldWithdrawal,
  listWithdrawalsForActor,
  requestWithdrawal,
  WITHDRAWAL_CANCEL_WINDOW_HOURS,
  WITHDRAWAL_HOLD_HOURS,
  withdrawableBalance,
} from "./withdrawal";

let userId = "";
let accountId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `w-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(userId, 0);
  accountId = accounts.find((a) => a.type === "LIVE")!.id;
});

afterEach(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.withdrawal.deleteMany({ where: { userId } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("withdrawableBalance", () => {
  it("counts real balance as withdrawable", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 50_000 } });
    expect((await withdrawableBalance(accountId)).withdrawable).toBe(50_000);
  });

  it("excludes bonus funds from the withdrawable balance", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(10_000);
    expect(result.lockedBonus).toBe(5_000);
  });

  it("keeps the bonus locked even after turnover is met (bonus is never withdrawable)", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });
    await prisma.bonusGrant.create({
      data: { accountId, amount: 5_000, turnoverRequired: 150_000, turnoverDone: 150_000 },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(10_000);
    expect(result.lockedBonus).toBe(5_000);
  });
});

describe("requestWithdrawal", () => {
  beforeEach(async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 50_000 } });
    const d = await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 50_000,
        amountInr: 5_382_000,
        vpa: "asmtrade.demo1@okaxis",
        checkoutToken: `wt-${randomUUID()}`,
        status: "COMPLETED",
        correlationId: "cid",
        expiresAt: new Date(),
      },
    });
    // Backdate the first-deposit completion to outside the hold window — this
    // suite tests the plain REQUESTED path, not the first-withdrawal hold.
    // The hold is covered separately below.
    await prisma.$executeRaw`UPDATE "Deposit" SET "updatedAt" = ${new Date(
      Date.now() - 1000 * 60 * 60 * 24 * 7,
    )} WHERE "id" = ${d.id}`;
  });

  it("creates a request and debits the balance", async () => {
    const withdrawal = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 20_000,
      method: "PhonePe",
    });
    expect(withdrawal.status).toBe("REQUESTED");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(30_000);

    const list = await listWithdrawalsForActor(userId, 20);
    expect(list.map((w) => w.id)).toContain(withdrawal.id);
  });

  it("writes exactly one matching ledger row", async () => {
    const withdrawal = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 20_000,
      method: "PhonePe",
    });
    const rows = await prisma.transaction.findMany({
      where: { refType: "Withdrawal", refId: withdrawal.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-20_000);
    expect(rows[0]!.balanceAfter).toBe(30_000);
  });

  it("refuses more than the withdrawable balance", async () => {
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 90_000, method: "PhonePe" }),
    ).rejects.toThrow(/balance/i);
  });

  it("refuses a method never used for a completed deposit", async () => {
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 10_000, method: "PayTM" }),
    ).rejects.toThrow(/method/i);
  });

  it("refuses another user's account", async () => {
    const other = await prisma.user.create({
      data: { email: `ow-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    await expect(
      requestWithdrawal({ actorId: other.id, accountId, amount: 10_000, method: "PhonePe" }),
    ).rejects.toThrow(/not found/i);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("refuses withdrawing demo funds", async () => {
    const demo = await prisma.account.findFirstOrThrow({ where: { userId, type: "DEMO" } });
    await prisma.account.update({ where: { id: demo.id }, data: { realBalance: 50_000 } });
    await expect(
      requestWithdrawal({ actorId: userId, accountId: demo.id, amount: 10_000, method: "PhonePe" }),
    ).rejects.toThrow(/demo/i);
  });
});

describe("requestWithdrawal — anti-fraud gates", () => {
  it("refuses when the user's status is not ACTIVE", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 100_000 },
    });
    await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 1000,
        amountInr: 100_000,
        vpa: "x@y",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "COMPLETED",
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { status: "FROZEN", statusReason: "test freeze" },
    });
    await expect(
      requestWithdrawal({
        actorId: userId,
        accountId,
        amount: 10_000,
        method: "PhonePe",
      }),
    ).rejects.toThrow(/paused/i);
  });

  it("refuses when the payment method belongs to a different user", async () => {
    // The primary user completes a deposit on PhonePe.
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 100_000 },
    });
    await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 1000,
        amountInr: 100_000,
        vpa: "x@y",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "COMPLETED",
      },
    });
    // A second user has ALSO used PhonePe with a completed deposit — that
    // makes the method shared, so withdrawing to it from the primary user
    // is a hedging/laundering path and must be refused.
    const foreigner = await prisma.user.create({
      data: { email: `fx-${randomUUID()}@t.local`, passwordHash: "x" },
    });
    try {
      await createAccountsForUser(foreigner.id, 0);
      await prisma.deposit.create({
        data: {
          userId: foreigner.id,
          method: "PhonePe",
          amountUsd: 1000,
          amountInr: 100_000,
          vpa: "x@y",
          checkoutToken: randomUUID(),
          correlationId: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          status: "COMPLETED",
        },
      });

      await expect(
        requestWithdrawal({
          actorId: userId,
          accountId,
          amount: 10_000,
          method: "PhonePe",
        }),
      ).rejects.toThrow(/another account/i);
    } finally {
      await prisma.transaction.deleteMany({ where: { account: { userId: foreigner.id } } });
      await prisma.deposit.deleteMany({ where: { userId: foreigner.id } });
      await prisma.account.deleteMany({ where: { userId: foreigner.id } });
      await prisma.user.delete({ where: { id: foreigner.id } });
    }
  });

  it("stores ipAddress and userAgent on the Withdrawal row", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 50_000 },
    });
    await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 500,
        amountInr: 50_000,
        vpa: "x@y",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "COMPLETED",
      },
    });
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 1_000,
      method: "PhonePe",
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla-test",
    });
    const fresh = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    expect(fresh.ipAddress).toBe("203.0.113.7");
    expect(fresh.userAgent).toBe("Mozilla-test");
  });
});

describe("requestWithdrawal — first-withdrawal hold", () => {
  async function seedCompletedDeposit(opts: { completedAt?: Date } = {}): Promise<void> {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 50_000 } });
    const d = await prisma.deposit.create({
      data: {
        userId,
        method: "PhonePe",
        amountUsd: 500,
        amountInr: 50_000,
        vpa: "x@y",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        status: "COMPLETED",
      },
    });
    if (opts.completedAt) {
      // Prisma's @updatedAt overrides any value we pass through the client,
      // so backdate via raw SQL. The row is otherwise untouched.
      await prisma.$executeRaw`UPDATE "Deposit" SET "updatedAt" = ${opts.completedAt} WHERE "id" = ${d.id}`;
    }
  }

  it("qualifies for hold when first withdrawal within 48h of first deposit", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 10_000,
      method: "PhonePe",
    });
    expect(w.status).toBe("HELD");
    expect(w.holdUntil).toBeInstanceOf(Date);
    expect(w.cancelableUntil).toBeInstanceOf(Date);
    // holdUntil should sit near createdAt + WITHDRAWAL_HOLD_HOURS.
    const holdDeltaMs = w.holdUntil!.getTime() - w.createdAt.getTime();
    expect(holdDeltaMs).toBeGreaterThanOrEqual(WITHDRAWAL_HOLD_HOURS * 60 * 60 * 1000 - 5_000);
    expect(holdDeltaMs).toBeLessThanOrEqual(WITHDRAWAL_HOLD_HOURS * 60 * 60 * 1000 + 5_000);
    const cancelDeltaMs = w.cancelableUntil!.getTime() - w.createdAt.getTime();
    expect(cancelDeltaMs).toBeGreaterThanOrEqual(
      WITHDRAWAL_CANCEL_WINDOW_HOURS * 60 * 60 * 1000 - 5_000,
    );
    expect(cancelDeltaMs).toBeLessThanOrEqual(
      WITHDRAWAL_CANCEL_WINDOW_HOURS * 60 * 60 * 1000 + 5_000,
    );
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(40_000);
  });

  it("does not hold on second withdrawal", async () => {
    await seedCompletedDeposit();
    await prisma.withdrawal.create({
      data: {
        userId,
        amount: 1_000,
        method: "PhonePe",
        status: "PAID",
      },
    });
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 5_000,
      method: "PhonePe",
    });
    expect(w.status).toBe("REQUESTED");
    expect(w.holdUntil).toBeNull();
    expect(w.cancelableUntil).toBeNull();
  });

  it("does not hold when > 48h past first deposit", async () => {
    await seedCompletedDeposit({ completedAt: new Date(Date.now() - 1000 * 60 * 60 * 72) });
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 5_000,
      method: "PhonePe",
    });
    expect(w.status).toBe("REQUESTED");
    expect(w.holdUntil).toBeNull();
  });

  it("cancel within window returns funds and sets CANCELLED_BY_USER", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 7_000,
      method: "PhonePe",
    });
    expect(w.status).toBe("HELD");
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(before.realBalance).toBe(43_000);

    const cancelled = await cancelHeldWithdrawal({ actorId: userId, withdrawalId: w.id });
    expect(cancelled.status).toBe("CANCELLED_BY_USER");

    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.realBalance).toBe(50_000);

    // Refund ledger row.
    const rows = await prisma.transaction.findMany({
      where: { refType: "Withdrawal", refId: w.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amount).toBe(-7_000);
    expect(rows[1]!.amount).toBe(7_000);
  });

  it("cancel after cancelableUntil refuses", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 3_000,
      method: "PhonePe",
    });
    // Rewind the cancel window into the past so the gate trips.
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { cancelableUntil: new Date(Date.now() - 60_000) },
    });

    await expect(
      cancelHeldWithdrawal({ actorId: userId, withdrawalId: w.id }),
    ).rejects.toThrow(/cancel/i);
  });

  it("cancel after already cancelled refuses", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 2_000,
      method: "PhonePe",
    });
    await cancelHeldWithdrawal({ actorId: userId, withdrawalId: w.id });
    await expect(
      cancelHeldWithdrawal({ actorId: userId, withdrawalId: w.id }),
    ).rejects.toThrow(/no longer be cancelled/i);
  });

  it("cancel by non-owner refuses", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 2_000,
      method: "PhonePe",
    });
    const other = await prisma.user.create({
      data: { email: `cx-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    try {
      await expect(
        cancelHeldWithdrawal({ actorId: other.id, withdrawalId: w.id }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("auto-promote flips HELD → REQUESTED when holdUntil passed", async () => {
    await seedCompletedDeposit();
    const w = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 1_500,
      method: "PhonePe",
    });
    // Still in the future — no-op.
    const first = await autoPromoteHeldWithdrawals();
    expect(first).toBe(0);

    // Push holdUntil into the past.
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { holdUntil: new Date(Date.now() - 60_000) },
    });
    const second = await autoPromoteHeldWithdrawals();
    expect(second).toBe(1);
    const fresh = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    expect(fresh.status).toBe("REQUESTED");

    // A second call does nothing — nothing is HELD any more.
    const third = await autoPromoteHeldWithdrawals();
    expect(third).toBe(0);
  });
});
