import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  listWithdrawalsForActor,
  requestWithdrawal,
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

  it("excludes bonus funds while turnover is outstanding", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });
    await prisma.bonusGrant.create({
      data: { accountId, amount: 5_000, turnoverRequired: 150_000, turnoverDone: 0 },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(10_000);
    expect(result.lockedBonus).toBe(5_000);
    expect(result.turnoverRemaining).toBe(150_000);
  });

  it("releases bonus funds once turnover is met", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 10_000, bonusBalance: 5_000 },
    });
    await prisma.bonusGrant.create({
      data: { accountId, amount: 5_000, turnoverRequired: 150_000, turnoverDone: 150_000 },
    });

    const result = await withdrawableBalance(accountId);
    expect(result.withdrawable).toBe(15_000);
    expect(result.turnoverRemaining).toBe(0);
  });
});

describe("requestWithdrawal", () => {
  beforeEach(async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: 50_000 } });
    await prisma.deposit.create({
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
