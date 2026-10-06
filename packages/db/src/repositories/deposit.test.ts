import { randomBytes, randomUUID } from "node:crypto";
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
  claimUsdtPayment,
  createDepositIntent,
  createUsdtDepositIntent,
  creditDepositToAccount,
  depositCreditMinor,
  expireStaleUsdtDeposits,
  USDT_RESERVATION_QUARANTINE_MS,
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

  it("credits a USDT account with the reserved USDT-cents amount and consumes the chain credit", async () => {
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 15_000,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });
    const chainCredit = await prisma.chainCredit.create({
      data: {
        network: "tron",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        txHash: `tx-${randomUUID()}`,
        eventIndex: 0,
        fromAddress: "TSender11111111111111111111111111",
        toAddress: "TReceivingAddress1111111111111111",
        rawAmount: (BigInt(deposit.amountUsdtMinor!) * 10_000n).toString(),
        normalizedAmountMinor: deposit.amountUsdtMinor,
        blockNumber: 1_000_000n,
        blockTimestamp: new Date(),
        finalityState: "FINAL",
        rawPayload: {},
      },
    });
    const before = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;

    await creditDepositToAccount({ depositId: deposit.id, adminId: null, chainCreditId: chainCredit.id });

    const updatedDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(updatedDeposit.status).toBe("COMPLETED");
    expect(updatedDeposit.matchedChainCreditId).toBe(chainCredit.id);

    const updatedCredit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: chainCredit.id } });
    expect(updatedCredit.consumed).toBe(true);
    expect(updatedCredit.processingStatus).toBe("MATCHED");

    const after = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    expect(after.realBalance - before).toBe(deposit.amountUsdtMinor);

    await prisma.chainCredit.delete({ where: { id: chainCredit.id } });
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("two concurrent credit attempts on the same ChainCredit result in exactly one credit — the loser gets DepositAlreadyResolved", async () => {
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 16_000,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });
    const chainCredit = await prisma.chainCredit.create({
      data: {
        network: "tron",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        txHash: `tx-${randomUUID()}`,
        eventIndex: 0,
        fromAddress: "TSender11111111111111111111111111",
        toAddress: "TReceivingAddress1111111111111111",
        rawAmount: (BigInt(deposit.amountUsdtMinor!) * 10_000n).toString(),
        normalizedAmountMinor: deposit.amountUsdtMinor,
        blockNumber: 1_000_000n,
        blockTimestamp: new Date(),
        finalityState: "FINAL",
        rawPayload: {},
      },
    });

    const attempt = () =>
      creditDepositToAccount({ depositId: deposit.id, adminId: null, chainCreditId: chainCredit.id });
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DepositAlreadyResolved);

    // Exactly one DEPOSIT-kind row — not "exactly one Transaction row", since
    // a single successful credit legitimately writes two (DEPOSIT +
    // BONUS_GRANT, both refId'd to this deposit, per BONUS_PERCENT).
    const depositTxCount = await prisma.transaction.count({
      where: { account: { userId }, refType: "Deposit", refId: deposit.id, kind: "DEPOSIT" },
    });
    expect(depositTxCount).toBe(1);

    await prisma.transaction.deleteMany({ where: { account: { userId }, refId: deposit.id } });
    await prisma.chainCredit.delete({ where: { id: chainCredit.id } });
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("credits a USDT deposit into an INR account as paise (×100), never the negative amountInr sentinel", async () => {
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 17_000,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });
    expect(deposit.amountInr).toBeLessThan(0); // the uniqueness sentinel
    const usdt = deposit.amountUsdtMinor!;
    const before = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await creditDepositToAccount({ depositId: deposit.id, adminId: null });

    const after = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    expect(after.realBalance - before.realBalance).toBe(usdt * 100);
    expect(after.bonusBalance - before.bonusBalance).toBe(usdt * 100);
    const tx = await prisma.transaction.findFirstOrThrow({
      where: { accountId: after.id, refId: deposit.id, kind: "DEPOSIT" },
    });
    expect(tx.amount).toBe(usdt * 100);
    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(userAfter.cumulativeDeposits - userBefore.cumulativeDeposits).toBe(usdt * 100);
  });

  it("credits a USDT deposit into a USD account 1:1 in cents", async () => {
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USD" } });
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 18_000,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });
    const before = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;

    await creditDepositToAccount({ depositId: deposit.id, adminId: null });

    const after = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;
    expect(after - before).toBe(deposit.amountUsdtMinor);
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("refuses adminResolution without a chainCreditId", async () => {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 19_000,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });
    await expect(
      creditDepositToAccount({ depositId: deposit.id, adminId: "admin", adminResolution: { usdtMinorOverride: 100 } }),
    ).rejects.toThrow(/chainCreditId/);
    const unchanged = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(unchanged.status).toBe("AWAITING_PAYMENT");
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

describe("depositCreditMinor", () => {
  const usdt = { method: "USDT", amountInr: -12_345, amountUsd: 0, amountUsdtMinor: 12_345 };
  const upi = { method: "upi", amountInr: 1_000_037, amountUsd: 9_291, amountUsdtMinor: null };

  it("converts USDT-cents to the account currency and never uses the sentinel columns", () => {
    expect(depositCreditMinor(usdt, "INR")).toBe(1_234_500);
    expect(depositCreditMinor(usdt, "USD")).toBe(12_345);
    expect(depositCreditMinor(usdt, "USDT")).toBe(12_345);
    expect(depositCreditMinor(usdt, "INR", 10_000)).toBe(1_000_000);
  });

  it("keeps INR/UPI semantics unchanged", () => {
    expect(depositCreditMinor(upi, "INR")).toBe(1_000_037);
    expect(depositCreditMinor(upi, "USD")).toBe(9_291);
  });

  it("throws rather than guess or produce a non-positive credit", () => {
    expect(() => depositCreditMinor(usdt, "EUR")).toThrow();
    expect(() => depositCreditMinor({ ...usdt, amountUsdtMinor: null }, "INR")).toThrow();
    expect(() => depositCreditMinor(usdt, "INR", 0)).toThrow();
    expect(() => depositCreditMinor({ ...upi, amountInr: -5 }, "INR")).toThrow();
    expect(() => depositCreditMinor(upi, "USDT")).toThrow();
  });
});

describe("expireStaleUsdtDeposits", () => {
  it("expires only USDT deposits past the quarantine, never INR ones", async () => {
    const HOUR = 60 * 60 * 1000;
    const mk = (amountUsdtMinorRequested: number) =>
      createUsdtDepositIntent({
        userId,
        amountUsdtMinorRequested,
        network: "tron",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        receivingAddress: "TReceivingAddress1111111111111111",
        correlationId: randomUUID(),
      });
    const stale = await mk(21_000);
    const recent = await mk(22_000);
    const inr = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_300_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 49 * HOUR) } });
    await prisma.deposit.update({ where: { id: recent.id }, data: { expiresAt: new Date(Date.now() - 1 * HOUR) } });
    await prisma.deposit.update({ where: { id: inr.id }, data: { expiresAt: new Date(Date.now() - 500 * HOUR) } });

    const count = await expireStaleUsdtDeposits(new Date(Date.now() - USDT_RESERVATION_QUARANTINE_MS));
    expect(count).toBeGreaterThanOrEqual(1);

    const status = async (id: string) => (await prisma.deposit.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(stale.id)).toBe("EXPIRED");
    expect(await status(recent.id)).toBe("AWAITING_PAYMENT");
    expect(await status(inr.id)).toBe("AWAITING_PAYMENT");
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

  it("throws DepositAlreadyResolved — not UtrAlreadyClaimed — when the auto-matcher completed the deposit first", async () => {
    // Manufactures the live race the fix is for: the SMS pipeline matches
    // and completes the deposit (status moves off AWAITING_PAYMENT, but
    // claimedUtr stays null — the matcher never writes a UTR), then the
    // user tries to submit a manual UTR anyway. The old code lumped this
    // into UtrAlreadyClaimed ("A reference has already been submitted"),
    // which is a lie and sent the user to resubmit forever.
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_800_000,
      correlationId: randomUUID(),
    });
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: "COMPLETED" },
    });
    await expect(claimUtr(userId, deposit.id, "444444444444")).rejects.toBeInstanceOf(
      DepositAlreadyResolved,
    );
  });
});

describe("claimUsdtPayment", () => {
  const hash = () => randomBytes(32).toString("hex");
  const usdtDeposit = (requested: number) =>
    createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: requested,
      network: "tron",
      tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      receivingAddress: "TReceivingAddress1111111111111111",
      correlationId: randomUUID(),
    });

  it("records the lowercased hash + screenshot, leaves status alone, and audits", async () => {
    const deposit = await usdtDeposit(31_000);
    const h = hash();
    const screenshotUrl = "https://res.cloudinary.com/demo/image/upload/v1/deposits/x.png";
    const claimed = await claimUsdtPayment({
      actorId: userId,
      depositId: deposit.id,
      txHash: `0x${h.toUpperCase()}`,
      screenshotUrl,
    });
    expect(claimed.claimedTxHash).toBe(h);
    expect(claimed.screenshotUrl).toBe(screenshotUrl);
    expect(claimed.status).toBe("AWAITING_PAYMENT");
    expect(claimed.matchedChainCreditId).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: "deposit.usdt_payment_claimed", targetId: deposit.id },
    });
    expect(audit?.actorId).toBe(userId);
    expect(audit?.after).toEqual({ txHash: h, hasScreenshot: true });
  });

  it("lets the owner overwrite an earlier claim, including on an EXPIRED deposit", async () => {
    const deposit = await usdtDeposit(32_000);
    await claimUsdtPayment({ actorId: userId, depositId: deposit.id, txHash: hash() });
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "EXPIRED" } });
    const second = hash();
    const claimed = await claimUsdtPayment({ actorId: userId, depositId: deposit.id, txHash: second });
    expect(claimed.claimedTxHash).toBe(second);
    expect(claimed.status).toBe("EXPIRED");
  });

  it("refuses another user's deposit as if it did not exist", async () => {
    const deposit = await usdtDeposit(33_000);
    const other = await prisma.user.create({
      data: { email: `usdt-claim-other-${randomUUID()}@test.local`, passwordHash: "x" },
    });
    try {
      await expect(
        claimUsdtPayment({ actorId: other.id, depositId: deposit.id, txHash: hash() }),
      ).rejects.toBeInstanceOf(DepositNotFound);
      const fresh = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      expect(fresh.claimedTxHash).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("refuses a COMPLETED deposit as already resolved", async () => {
    const deposit = await usdtDeposit(34_000);
    await prisma.deposit.update({ where: { id: deposit.id }, data: { status: "COMPLETED" } });
    await expect(
      claimUsdtPayment({ actorId: userId, depositId: deposit.id, txHash: hash() }),
    ).rejects.toBeInstanceOf(DepositAlreadyResolved);
  });

  it("refuses a non-USDT deposit as not found", async () => {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 1_850_000,
      correlationId: randomUUID(),
    });
    await expect(
      claimUsdtPayment({ actorId: userId, depositId: deposit.id, txHash: hash() }),
    ).rejects.toBeInstanceOf(DepositNotFound);
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

describe("reverseUsdtDepositAndRequeue", () => {
  const NETWORK = "tron";
  const CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const RECEIVING = "TReceivingAddress1111111111111111";

  async function creditedUsdtDeposit(amountUsdtMinorRequested: number) {
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING,
      correlationId: randomUUID(),
    });
    const chainCredit = await prisma.chainCredit.create({
      data: {
        network: NETWORK,
        tokenContract: CONTRACT,
        txHash: `tx-${randomUUID()}`,
        eventIndex: 0,
        fromAddress: "TSender11111111111111111111111111",
        toAddress: RECEIVING,
        rawAmount: (BigInt(deposit.amountUsdtMinor!) * 10_000n).toString(),
        normalizedAmountMinor: deposit.amountUsdtMinor,
        blockNumber: 1_000_000n,
        blockTimestamp: new Date(),
        finalityState: "FINAL",
        rawPayload: {},
      },
    });
    await creditDepositToAccount({ depositId: deposit.id, adminId: null, chainCreditId: chainCredit.id });
    return { deposit, chainCreditId: chainCredit.id };
  }

  it("reverses the credit and puts the chain credit back in the review queue, un-consumed", async () => {
    const { reverseUsdtDepositAndRequeue } = await import("./deposit");
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const { deposit, chainCreditId } = await creditedUsdtDeposit(45_000);
    const before = (await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } })).realBalance;

    await reverseUsdtDepositAndRequeue({
      depositId: deposit.id,
      adminId: "admin-panel",
      reason: "credited to the wrong user's deposit",
    });

    const afterDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(afterDeposit.status).toBe("REJECTED");

    const afterAccount = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
    expect(afterAccount.realBalance).toBe(before - deposit.amountUsdtMinor!);

    const credit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: chainCreditId } });
    expect(credit.consumed).toBe(false);
    expect(credit.processingStatus).toBe("MANUAL_REVIEW");
    expect(credit.reviewReason).toBe("ADMIN_REVERSED");

    const audit = await prisma.auditLog.findFirst({
      where: { targetType: "ChainCredit", targetId: chainCreditId, action: "chain_credit.requeued_after_reversal" },
    });
    expect(audit).not.toBeNull();

    await prisma.chainCredit.delete({ where: { id: chainCreditId } });
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("the requeued chain credit can then be credited to the correct deposit", async () => {
    const { reverseUsdtDepositAndRequeue } = await import("./deposit");
    const { resolveChainCreditToDeposit } = await import("./chain-credit-admin");
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const { deposit: wrongDeposit, chainCreditId } = await creditedUsdtDeposit(46_000);
    const rightDeposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 46_500,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING,
      correlationId: randomUUID(),
    });

    await reverseUsdtDepositAndRequeue({ depositId: wrongDeposit.id, adminId: "admin-panel", reason: "wrong user" });
    await resolveChainCreditToDeposit({
      chainCreditId,
      depositId: rightDeposit.id,
      adminId: "admin-panel",
      expectedNetwork: NETWORK,
      expectedTokenContract: CONTRACT,
      expectedReceivingAddress: RECEIVING,
    });

    const finalDeposit = await prisma.deposit.findUniqueOrThrow({ where: { id: rightDeposit.id } });
    expect(finalDeposit.status).toBe("COMPLETED");
    expect(finalDeposit.matchedChainCreditId).toBe(chainCreditId);

    await prisma.chainCredit.delete({ where: { id: chainCreditId } });
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("refuses a non-USDT deposit", async () => {
    const { reverseUsdtDepositAndRequeue, DepositReversalRefused } = await import("./deposit");
    // Pin currency explicitly — a prior test in this block leaves it at USDT.
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor: 2_000_000,
      correlationId: randomUUID(),
    });
    await claimUtr(userId, deposit.id, "999999999903");
    await creditDepositToAccount({ depositId: deposit.id, adminId: "admin-panel", creditId: null });

    await expect(
      reverseUsdtDepositAndRequeue({ depositId: deposit.id, adminId: "admin-panel", reason: "x" }),
    ).rejects.toBeInstanceOf(DepositReversalRefused);

    // Nothing should have moved — refused before the transaction even opened.
    const unchanged = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(unchanged.status).toBe("COMPLETED");
  });

  it("refuses a USDT deposit with no linked chain credit (e.g. an admin-approved-without-evidence case)", async () => {
    const { reverseUsdtDepositAndRequeue, DepositReversalRefused } = await import("./deposit");
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const deposit = await createUsdtDepositIntent({
      userId,
      amountUsdtMinorRequested: 47_000,
      network: NETWORK,
      tokenContract: CONTRACT,
      receivingAddress: RECEIVING,
      correlationId: randomUUID(),
    });
    await creditDepositToAccount({ depositId: deposit.id, adminId: "admin-panel", creditId: null, chainCreditId: null });

    await expect(
      reverseUsdtDepositAndRequeue({ depositId: deposit.id, adminId: "admin-panel", reason: "x" }),
    ).rejects.toBeInstanceOf(DepositReversalRefused);

    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });

  it("does not requeue when the balance can't be reclaimed and force is not set — the whole reversal rolls back", async () => {
    const { reverseUsdtDepositAndRequeue, DepositReversalRefused } = await import("./deposit");
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "USDT" } });
    const { deposit, chainCreditId } = await creditedUsdtDeposit(48_000);
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { realBalance: 0, bonusBalance: 0 } });

    await expect(
      reverseUsdtDepositAndRequeue({ depositId: deposit.id, adminId: "admin-panel", reason: "x" }),
    ).rejects.toBeInstanceOf(DepositReversalRefused);

    const credit = await prisma.chainCredit.findUniqueOrThrow({ where: { id: chainCreditId } });
    expect(credit.consumed).toBe(true); // untouched — the transaction rolled back

    await prisma.chainCredit.delete({ where: { id: chainCreditId } });
    await prisma.account.updateMany({ where: { userId, type: "LIVE" }, data: { currency: "INR" } });
  });
});
