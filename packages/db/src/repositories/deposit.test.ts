import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  MAX_DEPOSIT_USD_MINOR,
  MIN_DEPOSIT_USD_MINOR,
  USD_TO_INR_RATE,
  createDepositIntent,
  creditDepositToAccount,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
} from "./deposit";
import { createAccountsForUser } from "./account";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `deposit-test-${Date.now()}@test.local`,
      passwordHash: "x",
    },
  });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.transaction.deleteMany({
    where: { account: { userId } },
  });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("createDepositIntent", () => {
  it("rejects an amount below the minimum", async () => {
    await expect(
      createDepositIntent({
        userId,
        method: "upi",
        amountUsdMinor: MIN_DEPOSIT_USD_MINOR - 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/minimum/);
  });

  it("rejects an amount above the maximum", async () => {
    await expect(
      createDepositIntent({
        userId,
        method: "upi",
        amountUsdMinor: MAX_DEPOSIT_USD_MINOR + 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/maximum/);
  });

  it("reserves an amount within ±999/+1000 paise of the converted base", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 10_000, // $100.00
      correlationId: randomUUID(),
    });
    const baseInr = Math.round(10_000 * USD_TO_INR_RATE);
    // The offset pool spans -999..+1000 inclusive (2000 values) and does
    // include 0 — an assigned amount landing exactly on the round base is
    // rare (~1-in-2000) but not excluded by design, so this only asserts
    // the range, not "never exactly the base" (which would make this test
    // flaky).
    expect(deposit.amountInr).toBeGreaterThanOrEqual(baseInr - 999);
    expect(deposit.amountInr).toBeLessThanOrEqual(baseInr + 1000);
    expect(deposit.amountUsd).toBe(10_000);
    expect(deposit.status).toBe("AWAITING_PAYMENT");
  });

  it("never reserves the same amount for two live deposits", async () => {
    const a = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 20_000,
      correlationId: randomUUID(),
    });
    const b = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 20_000,
      correlationId: randomUUID(),
    });
    expect(a.amountInr).not.toBe(b.amountInr);
  });
});

describe("findLiveDepositByAmount", () => {
  it("finds a live deposit by its exact reserved amount", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 15_000,
      correlationId: randomUUID(),
    });
    const found = await findLiveDepositByAmount(deposit.amountInr);
    expect(found.map((d) => d.id)).toContain(deposit.id);
  });

  it("returns an empty array for an amount no live deposit has reserved", async () => {
    const found = await findLiveDepositByAmount(999_999_999);
    expect(found).toEqual([]);
  });
});

describe("findLiveDepositByClaimedUtr", () => {
  it("finds a live deposit by its claimed UTR", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 25_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { claimedUtr: "utr-test-12345", status: "PENDING_CONFIRMATION" },
    });
    const found = await findLiveDepositByClaimedUtr("utr-test-12345");
    expect(found?.id).toBe(deposit.id);
  });

  it("returns null when no live deposit claims that UTR", async () => {
    const found = await findLiveDepositByClaimedUtr("no-such-utr");
    expect(found).toBeNull();
  });
});

describe("creditDepositToAccount", () => {
  it("marks the deposit COMPLETED, credits the account, and consumes the credit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 30_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "PENDING_CONFIRMATION" },
    });
    const credit = await prisma.bankCredit.create({
      data: {
        vpa: "relayed",
        amountInr: deposit.amountInr,
        utr: `utr-credit-${Date.now()}`,
        receivedAt: new Date(),
        raw: "test",
      },
    });

    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: null,
      creditId: credit.id,
    });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.matchedCreditId).toBe(credit.id);

    const consumedCredit = await prisma.bankCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(consumedCredit.consumed).toBe(true);

    const account = await prisma.account.findFirstOrThrow({
      where: { userId, type: "LIVE" },
    });
    expect(account.realBalance).toBe(30_000);
  });

  it("throws AmountSpaceExhausted-unrelated DepositAlreadyResolved when called twice", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountUsdMinor: 35_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "PENDING_CONFIRMATION" },
    });
    await creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: null });
    await expect(
      creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: null }),
    ).rejects.toThrow();
  });
});
