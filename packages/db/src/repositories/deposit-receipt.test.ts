import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake client: this file never touches a database (shared or local). It checks what is asked of Prisma and how the
// answers become a receipt.
const db = vi.hoisted(() => ({
  transaction: { findMany: vi.fn() },
  bankCredit: { findUnique: vi.fn() },
}));
vi.mock("../client", () => ({ prisma: db }));

import { buildDepositReceipt, getDepositReceipt, type ReceiptTx } from "./deposit-receipt";

const CREATED = new Date("2026-10-21T10:01:00.000Z");
const deposit = { id: "dep-1", userId: "user-1", status: "COMPLETED" as const, claimedUtr: null as string | null, matchedCreditId: null as string | null };

const depositTx = (over: Partial<ReceiptTx> = {}): ReceiptTx => ({ kind: "DEPOSIT", amount: 200000, balanceAfter: 1645000, createdAt: CREATED, account: { currency: "INR" }, ...over });
const bonusTx = (over: Partial<ReceiptTx> = {}): ReceiptTx => ({ kind: "BONUS_GRANT", amount: 200000, balanceAfter: 1645000, createdAt: CREATED, account: { currency: "INR" }, ...over });

beforeEach(() => {
  db.transaction.findMany.mockReset();
  db.bankCredit.findUnique.mockReset();
});

describe("buildDepositReceipt", () => {
  it("reads the credit, the bonus and the balance after it from the deposit's transactions", () => {
    expect(buildDepositReceipt({ txs: [depositTx(), bonusTx()], utr: "428713905561" })).toEqual({
      creditedAt: CREATED,
      creditedMinor: 200000,
      creditedCurrency: "INR",
      bonusMinor: 200000,
      balanceAfterMinor: 1645000,
      utr: "428713905561",
    });
  });

  it("has no bonus when none was granted", () => {
    expect(buildDepositReceipt({ txs: [depositTx()], utr: null }).bonusMinor).toBeNull();
  });

  it("takes the earliest credit when there are several rows", () => {
    const later = depositTx({ amount: 5, createdAt: new Date(CREATED.getTime() + 1000) });
    expect(buildDepositReceipt({ txs: [later, depositTx()], utr: null }).creditedMinor).toBe(200000);
  });

  it("ignores debits and zero amounts", () => {
    expect(buildDepositReceipt({ txs: [depositTx({ amount: -200000 }), bonusTx({ amount: 0 })], utr: null })).toEqual({
      creditedAt: null,
      creditedMinor: null,
      creditedCurrency: null,
      bonusMinor: null,
      balanceAfterMinor: null,
      utr: null,
    });
  });

  it("converts bigint amounts and refuses a value that is not a safe integer", () => {
    const big = buildDepositReceipt({ txs: [depositTx({ amount: 200000n, balanceAfter: 1645000n })], utr: null });
    expect(big.creditedMinor).toBe(200000);
    expect(big.balanceAfterMinor).toBe(1645000);
    const huge = buildDepositReceipt({ txs: [depositTx({ amount: 2n ** 60n, balanceAfter: 2n ** 60n }), bonusTx({ amount: 2n ** 60n })], utr: null });
    expect(huge.creditedMinor).toBeNull();
    expect(huge.balanceAfterMinor).toBeNull();
    expect(huge.bonusMinor).toBeNull();
  });
});

describe("getDepositReceipt", () => {
  it("does not touch the database for a deposit that has not been credited, and keeps the UTR the user sent", async () => {
    const out = await getDepositReceipt({ ...deposit, status: "PENDING_CONFIRMATION", claimedUtr: "111222333" });
    expect(db.transaction.findMany).not.toHaveBeenCalled();
    expect(db.bankCredit.findUnique).not.toHaveBeenCalled();
    expect(out).toEqual({ creditedAt: null, creditedMinor: null, creditedCurrency: null, bonusMinor: null, balanceAfterMinor: null, utr: "111222333" });
  });

  it("asks only for this deposit's credit and bonus on the owner's LIVE account", async () => {
    db.transaction.findMany.mockResolvedValue([depositTx(), bonusTx()]);
    await getDepositReceipt({ ...deposit, claimedUtr: "111222333" });
    expect(db.transaction.findMany).toHaveBeenCalledTimes(1);
    const args = db.transaction.findMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      refType: "Deposit",
      refId: "dep-1",
      kind: { in: ["DEPOSIT", "BONUS_GRANT"] },
      amount: { gt: 0 },
      account: { userId: "user-1", type: "LIVE" },
    });
    expect(args.select.account).toEqual({ select: { currency: true } });
  });

  it("prefers the UTR the user claimed over the matched bank credit's", async () => {
    db.transaction.findMany.mockResolvedValue([depositTx()]);
    const out = await getDepositReceipt({ ...deposit, claimedUtr: "111222333", matchedCreditId: "bc-1" });
    expect(out.utr).toBe("111222333");
    expect(db.bankCredit.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the matched bank credit's UTR when the user never entered one", async () => {
    db.transaction.findMany.mockResolvedValue([depositTx()]);
    db.bankCredit.findUnique.mockResolvedValue({ utr: "428713905561" });
    const out = await getDepositReceipt({ ...deposit, matchedCreditId: "bc-1" });
    expect(db.bankCredit.findUnique).toHaveBeenCalledWith({ where: { id: "bc-1" }, select: { utr: true } });
    expect(out.utr).toBe("428713905561");
    expect(out.creditedMinor).toBe(200000);
  });

  it("has no UTR for a deposit with neither (USDT)", async () => {
    db.transaction.findMany.mockResolvedValue([depositTx({ account: { currency: "USD" } })]);
    const out = await getDepositReceipt(deposit);
    expect(out.utr).toBeNull();
    expect(out.creditedCurrency).toBe("USD");
  });
});
