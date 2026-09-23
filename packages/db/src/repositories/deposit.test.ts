import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import {
  DepositAlreadyResolved,
  DepositNotFound,
  MAX_DEPOSIT_INR_MINOR,
  MIN_DEPOSIT_INR_MINOR,
  USD_TO_INR_RATE,
  UtrAlreadyClaimed,
  claimUtr,
  createDepositIntent,
  creditDepositToAccount,
  findLiveDepositByAmount,
  findLiveDepositByClaimedUtr,
  getDepositByToken,
  listDepositsForActor,
  listPendingDeposits,
  rejectDeposit,
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
        amountInrMinor: MIN_DEPOSIT_INR_MINOR - 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/minimum/);
  });

  it("rejects an amount above the maximum", async () => {
    await expect(
      createDepositIntent({
        userId,
        method: "upi",
        amountInrMinor: MAX_DEPOSIT_INR_MINOR + 1,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow(/maximum/);
  });

  it("reserves an amount within ±999/+1000 paise of the requested rupees", async () => {
    const requestedInr = 1_000_000; // ₹10,000.00
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: requestedInr,
      correlationId: randomUUID(),
    });
    // The offset pool spans -999..+1000 inclusive around the requested amount,
    // so the reserved amount stays within about ±₹10 of what the user asked for.
    expect(deposit.amountInr).toBeGreaterThanOrEqual(requestedInr - 999);
    expect(deposit.amountInr).toBeLessThanOrEqual(requestedInr + 1000);
    // The USD figure is derived from the requested rupees for the record only.
    expect(deposit.amountUsd).toBe(Math.round(requestedInr / USD_TO_INR_RATE));
    expect(deposit.status).toBe("AWAITING_PAYMENT");
  });

  it("never reserves the same amount for two live deposits", async () => {
    const a = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_000_000,
      correlationId: randomUUID(),
    });
    const b = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_000_000,
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
      amountInrMinor: 1_500_000,
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
      amountInrMinor: 2_500_000,
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
      amountInrMinor: 3_000_000,
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
    // The account is INR by default, so it is credited the deposit's INR amount.
    expect(account.currency).toBe("INR");
    expect(account.realBalance).toBe(deposit.amountInr);
  });

  it("credits a USD account in USD rather than INR", async () => {
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USD" } });
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_500_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "PENDING_CONFIRMATION" } });
    const before = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;

    await creditDepositToAccount({ depositId: deposit.id, adminId: null, creditId: null });

    const after = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    expect(after.realBalance - before).toBe(deposit.amountUsd);
    // Restore INR for any later cases.
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("throws AmountSpaceExhausted-unrelated DepositAlreadyResolved when called twice", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 3_500_000,
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

describe("getDepositByToken", () => {
  it("finds a deposit by its checkout token", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 4_000_000,
      correlationId: randomUUID(),
    });
    const found = await getDepositByToken(deposit.checkoutToken);
    expect(found?.id).toBe(deposit.id);
  });

  it("returns null for an unknown token", async () => {
    expect(await getDepositByToken("no-such-token")).toBeNull();
  });
});

describe("listDepositsForActor", () => {
  it("returns only the actor's own deposits, newest first", async () => {
    const other = await prisma.user.create({
      data: { email: `list-other-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    await createDepositIntent({
      userId: other.id,
      method: "upi",
      amountInrMinor: 1_200_000,
      correlationId: randomUUID(),
    });
    const mine = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_300_000,
      correlationId: randomUUID(),
    });

    const list = await listDepositsForActor(userId, 100);
    expect(list.map((d) => d.id)).toContain(mine.id);
    expect(list.every((d) => d.userId === userId)).toBe(true);
    // Newest first.
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(list[i]!.createdAt.getTime());
    }

    await prisma.deposit.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});

describe("claimUtr", () => {
  it("records the reference and moves the deposit to PENDING_CONFIRMATION", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_400_000,
      correlationId: randomUUID(),
    });
    const claimed = await claimUtr(userId, deposit.id, "528312345678");
    expect(claimed.status).toBe("PENDING_CONFIRMATION");
    expect(claimed.claimedUtr).toBe("528312345678");
  });

  it("refuses a second claim on the same deposit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_600_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "111111111111");
    await expect(claimUtr(userId, deposit.id, "222222222222")).rejects.toBeInstanceOf(
      UtrAlreadyClaimed,
    );
  });

  it("refuses another user's deposit as if it did not exist", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_700_000,
      correlationId: randomUUID(),
    });
    const other = await prisma.user.create({
      data: { email: `claim-other-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    await expect(claimUtr(other.id, deposit.id, "333333333333")).rejects.toBeInstanceOf(
      DepositNotFound,
    );
    await prisma.user.delete({ where: { id: other.id } });
  });
});

describe("listPendingDeposits", () => {
  it("returns only PENDING_CONFIRMATION deposits", async () => {
    const awaiting = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_800_000,
      correlationId: randomUUID(),
    });
    const pending = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_900_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, pending.id, "444444444444");

    const list = await listPendingDeposits(50);
    const ids = list.map((d) => d.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(awaiting.id);
    expect(list.every((d) => d.status === "PENDING_CONFIRMATION")).toBe(true);
  });
});

describe("rejectDeposit", () => {
  it("marks a pending deposit REJECTED and writes an audit row", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_100_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "555555555555");

    await rejectDeposit({ depositId: deposit.id, adminId: "admin-panel", reason: "no credit" });

    const updated = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updated.status).toBe("REJECTED");

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: "Deposit", targetId: deposit.id, action: "deposit.rejected" },
    });
    expect(audit).not.toBeNull();
    await prisma.auditLog.deleteMany({ where: { targetId: deposit.id } });
  });

  it("refuses to reject an already-resolved deposit", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_200_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "666666666666");
    await rejectDeposit({ depositId: deposit.id, adminId: "admin-panel", reason: "x" });
    await expect(
      rejectDeposit({ depositId: deposit.id, adminId: "admin-panel", reason: "y" }),
    ).rejects.toBeInstanceOf(DepositAlreadyResolved);
    await prisma.auditLog.deleteMany({ where: { targetId: deposit.id } });
  });
});

describe("reverseCompletedDeposit", () => {
  it("decrements cumulativeDeposits, debits both balances, and audits the reversal", async () => {
    const { reverseCompletedDeposit } = await import("./deposit");

    // Explicitly pin the account currency for this test — an earlier test in
    // this file flips it to USD and does not reset it, which would make the
    // reversal decrement by amountUsd rather than amountInr and confuse the
    // deltas below.
    await prisma.account.updateMany({
      where: { userId, type: "LIVE" },
      data: { currency: "INR" },
    });

    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 5_000_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "999999999901");
    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: "admin-panel",
      creditId: null,
    });

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { cumulativeDeposits: true },
    });
    const accountBefore = await prisma.account.findFirstOrThrow({
      where: { userId, type: "LIVE" },
    });

    await reverseCompletedDeposit({
      depositId: deposit.id,
      adminId: "admin-panel",
      reason: "chargeback confirmed by acquirer",
    });

    const afterDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(afterDeposit.status).toBe("REJECTED");

    const afterUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { cumulativeDeposits: true },
    });
    // The reversal decrements by the deposit's exact `amountInr`, regardless
    // of what other tests in this file added earlier — the check is on the
    // DELTA, not the absolute value, so this test tolerates test-order effects.
    expect(afterUser.cumulativeDeposits).toBe(before.cumulativeDeposits - deposit.amountInr);

    const afterAccount = await prisma.account.findFirstOrThrow({
      where: { userId, type: "LIVE" },
    });
    // Same delta-based check: real drops by the deposit amount, bonus by the
    // matching 100% grant, and nothing else moves.
    const grantedBonus = Math.floor((deposit.amountInr * 100) / 100);
    expect(afterAccount.realBalance).toBe(accountBefore.realBalance - deposit.amountInr);
    expect(afterAccount.bonusBalance).toBe(accountBefore.bonusBalance - grantedBonus);

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: "Deposit", targetId: deposit.id, action: "deposit.reversed" },
    });
    expect(audit).not.toBeNull();
    await prisma.auditLog.deleteMany({ where: { targetId: deposit.id } });
  });

  it("refuses without force when the balance has been spent below what would be reclaimed", async () => {
    const { reverseCompletedDeposit, DepositReversalRefused } = await import("./deposit");

    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 3_000_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "999999999902");
    await creditDepositToAccount({
      depositId: deposit.id,
      adminId: "admin-panel",
      creditId: null,
    });
    // Simulate the user having burned all of it (a big losing trade).
    await prisma.account.updateMany({
      where: { userId, type: "LIVE" },
      data: { realBalance: 0, bonusBalance: 0 },
    });

    await expect(
      reverseCompletedDeposit({
        depositId: deposit.id,
        adminId: "admin-panel",
        reason: "chargeback",
      }),
    ).rejects.toBeInstanceOf(DepositReversalRefused);
  });
});
