import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  approveWithdrawal,
  autoPromoteHeldWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
  cancelHeldWithdrawal,
  listWithdrawalsForActor,
  requestWithdrawal,
  WITHDRAWAL_CANCEL_WINDOW_HOURS,
  WITHDRAWAL_HOLD_HOURS,
  withdrawableBalance,
} from "./withdrawal";

let userId = "";
let accountId = "";

const UPI = {
  payout: { method: "UPI", upiId: "me@okaxis" },
  destinationKey: "upi:me@okaxis",
} as const;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `w-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  // USD account: the $7 – $500 per-request limits keep these cent amounts valid.
  // The INR limits (₹700 – ₹50,000) have their own tests below.
  const accounts = await createAccountsForUser(userId, 0, "USD");
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
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
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
      ...UPI,
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
      ...UPI,
    });
    const rows = await prisma.transaction.findMany({
      where: { refType: "Withdrawal", refId: withdrawal.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(-20_000);
    expect(rows[0]!.balanceAfter).toBe(30_000);
  });

  it("refuses a withdrawal until the user's KYC is verified", async () => {
    for (const kycStatus of ["NOT_STARTED", "PENDING", "REJECTED"] as const) {
      await prisma.user.update({ where: { id: userId }, data: { kycStatus } });
      await expect(
        requestWithdrawal({ actorId: userId, accountId, amount: 10_000, ...UPI }),
      ).rejects.toThrow(/verify your identity/i);
    }
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(50_000);
  });

  it("refuses more than the withdrawable balance", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 30_000 } });
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 40_000, ...UPI }),
    ).rejects.toThrow(/balance/i);
  });

  it("pays out to a method the user never deposited with", async () => {
    // The user deposited by PhonePe (beforeEach) and withdraws to a bank account.
    const withdrawal = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 10_000,
      payout: { method: "BANK", accountHolder: "Test User", accountNumber: "123456789012", ifsc: "HDFC0001234" },
      destinationKey: "bank:HDFC0001234:123456789012",
    });
    expect(withdrawal).toMatchObject({
      method: "BANK",
      currency: "USD",
      accountHolder: "Test User",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
      upiId: null,
      usdtAddress: null,
      destinationKey: "bank:HDFC0001234:123456789012",
    });
  });

  it("stores the USDT network and address", async () => {
    const addr = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
    const withdrawal = await requestWithdrawal({
      actorId: userId,
      accountId,
      amount: 10_000,
      payout: { method: "USDT", usdtNetwork: "tron", usdtAddress: addr },
      destinationKey: `usdt:tron:${addr}`,
    });
    expect(withdrawal).toMatchObject({ method: "USDT", usdtNetwork: "tron", usdtAddress: addr });
  });

  it("refuses less than the $7 minimum on a USD account", async () => {
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 699, ...UPI }),
    ).rejects.toThrow(/minimum withdrawal is \$7/i);
  });

  it("refuses more than the $500 maximum on a USD account", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 100_000 } });
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 50_001, ...UPI }),
    ).rejects.toThrow(/maximum withdrawal is \$500/i);
  });

  it("enforces ₹700 – ₹50,000 on an INR account", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { currency: "INR", realBalance: 10_000_000 },
    });
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 699_99, ...UPI }),
    ).rejects.toThrow(/minimum withdrawal is ₹700/i);
    await expect(
      requestWithdrawal({ actorId: userId, accountId, amount: 50_000_01, ...UPI }),
    ).rejects.toThrow(/maximum withdrawal is ₹50,000/i);
    const ok = await requestWithdrawal({ actorId: userId, accountId, amount: 700_00, ...UPI });
    expect(ok.currency).toBe("INR");
  });

  it("refuses another user's account", async () => {
    const other = await prisma.user.create({
      data: { email: `ow-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    await expect(
      requestWithdrawal({ actorId: other.id, accountId, amount: 10_000, ...UPI }),
    ).rejects.toThrow(/not found/i);
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("refuses withdrawing demo funds", async () => {
    const demo = await prisma.account.findFirstOrThrow({ where: { userId, type: "DEMO" } });
    await prisma.account.update({ where: { id: demo.id }, data: { realBalance: 50_000 } });
    await expect(
      requestWithdrawal({ actorId: userId, accountId: demo.id, amount: 10_000, ...UPI }),
    ).rejects.toThrow(/demo/i);
  });
});

describe("requestWithdrawal — anti-fraud gates", () => {
  // Verified, so each test reaches the gate it targets rather than the KYC gate.
  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
  });

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
        ...UPI,
      }),
    ).rejects.toThrow(/paused/i);
  });

  // Regression: the old check compared method *labels* ("PhonePe", "USDT")
  // across users, so one user's deposit blocked everyone else's withdrawal.
  it("allows a withdrawal when another user deposited with the same method", async () => {
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
    // A second user has ALSO deposited with PhonePe — a shared rail, not a
    // shared destination, so it must not block the primary user.
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

      const w = await requestWithdrawal({
        actorId: userId,
        accountId,
        amount: 10_000,
        ...UPI,
      });
      // First withdrawal right after a deposit lands on the hold path.
      expect(["REQUESTED", "HELD"]).toContain(w.status);
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
      ...UPI,
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla-test",
    });
    const fresh = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    expect(fresh.ipAddress).toBe("203.0.113.7");
    expect(fresh.userAgent).toBe("Mozilla-test");
  });
});

describe("requestWithdrawal — first-withdrawal hold", () => {
  // Verified, so the hold logic is what's exercised — not the KYC gate.
  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
  });

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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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
      ...UPI,
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

describe("admin payout lifecycle", () => {
  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { kycStatus: "VERIFIED" } });
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 50_000 } });
  });

  it("marks an approved withdrawal paid, and only an approved one", async () => {
    const w = await requestWithdrawal({ actorId: userId, accountId, amount: 10_000, ...UPI });
    await expect(markWithdrawalPaid({ withdrawalId: w.id, adminId: "t" })).rejects.toThrow(/approved/i);

    await approveWithdrawal({ withdrawalId: w.id, adminId: "t" });
    await markWithdrawalPaid({ withdrawalId: w.id, adminId: "t" });
    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    expect(row.status).toBe("PAID");
    // Paying moves no money: the debit happened at request time.
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(40_000);
    await prisma.auditLog.deleteMany({ where: { targetId: w.id } });
  });

  it("rejects an approved-but-unpaid withdrawal and refunds it with the reason", async () => {
    const w = await requestWithdrawal({ actorId: userId, accountId, amount: 10_000, ...UPI });
    await approveWithdrawal({ withdrawalId: w.id, adminId: "t" });
    await rejectWithdrawal({ withdrawalId: w.id, adminId: "t", reason: "Wrong account" });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    expect(row).toMatchObject({ status: "REJECTED", reason: "Wrong account" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.realBalance).toBe(50_000);
    await prisma.auditLog.deleteMany({ where: { targetId: w.id } });
  });

  it("refuses to reject a paid withdrawal", async () => {
    const w = await requestWithdrawal({ actorId: userId, accountId, amount: 10_000, ...UPI });
    await approveWithdrawal({ withdrawalId: w.id, adminId: "t" });
    await markWithdrawalPaid({ withdrawalId: w.id, adminId: "t" });
    await expect(rejectWithdrawal({ withdrawalId: w.id, adminId: "t" })).rejects.toThrow(/already been reviewed/i);
    await prisma.auditLog.deleteMany({ where: { targetId: w.id } });
  });
});
