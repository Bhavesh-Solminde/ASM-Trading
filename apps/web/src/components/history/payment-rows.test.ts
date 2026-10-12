import { describe, expect, it } from "vitest";
import {
  depositMethodLabel,
  depositRow,
  referenceFor,
  withdrawalDestination,
  withdrawalMethodLabel,
  withdrawalRow,
  type DepositSource,
  type WithdrawalSource,
} from "./payment-rows";

const created = new Date("2026-10-12T05:12:00.000Z");

const deposit = (over: Partial<DepositSource> = {}): DepositSource => ({
  id: "1a2b3c4d-0000-0000-0000-000000000000",
  method: "UPI",
  status: "AWAITING_PAYMENT",
  createdAt: created,
  updatedAt: created,
  expiresAt: new Date("2026-10-12T05:42:00.000Z"),
  network: null,
  ...over,
});

const withdrawal = (over: Partial<WithdrawalSource> = {}): WithdrawalSource => ({
  id: "8f3k2q1a-0000-0000-0000-000000000000",
  method: "BANK",
  status: "REQUESTED",
  amount: 500000,
  currency: "INR",
  createdAt: created,
  holdUntil: null,
  cancelableUntil: null,
  accountNumber: "50100123451234",
  upiId: null,
  usdtNetwork: null,
  usdtAddress: null,
  ...over,
});

describe("method labels", () => {
  it("names the USDT network standard on deposits and withdrawals", () => {
    expect(depositMethodLabel({ method: "USDT", network: "tron" })).toBe("USDT TRC-20");
    expect(depositMethodLabel({ method: "USDT", network: "bsc" })).toBe("USDT BEP-20");
    expect(depositMethodLabel({ method: "USDT", network: null })).toBe("USDT");
    expect(depositMethodLabel({ method: "PhonePe", network: null })).toBe("PhonePe");
    expect(withdrawalMethodLabel({ method: "USDT", usdtNetwork: "tron" })).toBe("USDT TRC-20");
    expect(withdrawalMethodLabel({ method: "BANK", usdtNetwork: null })).toBe("Bank transfer");
  });

  it("passes legacy deposit-method labels through on old withdrawals", () => {
    expect(withdrawalMethodLabel({ method: "PhonePe", usdtNetwork: null })).toBe("PhonePe");
  });
});

describe("withdrawalDestination", () => {
  it("masks bank accounts and wallets, shows the UPI id, and is null without details", () => {
    expect(withdrawalDestination(withdrawal())).toBe("Bank •••• 1234");
    expect(withdrawalDestination(withdrawal({ method: "UPI", upiId: "asha@okhdfc", accountNumber: null }))).toBe("asha@okhdfc");
    expect(
      withdrawalDestination(withdrawal({ method: "USDT", usdtAddress: "TXyz9abc", accountNumber: null })),
    ).toBe("Wallet •••• 9abc");
    expect(withdrawalDestination(withdrawal({ method: "PhonePe", accountNumber: null }))).toBeNull();
  });
});

describe("rows", () => {
  it("builds a deposit row keyed d:<id> with the checkout deadline only while awaiting payment", () => {
    const awaiting = depositRow(deposit(), 100000, "INR");
    expect(awaiting.key).toBe("d:1a2b3c4d-0000-0000-0000-000000000000");
    expect(awaiting.expiresAt).toBe("2026-10-12T05:42:00.000Z");
    expect(depositRow(deposit({ status: "COMPLETED" }), 100000, "INR").expiresAt).toBeNull();
  });

  it("builds a withdrawal row keyed w:<id> and keeps the cancel window only for held ones", () => {
    const hold = new Date("2026-10-12T17:12:00.000Z");
    const held = withdrawalRow(withdrawal({ status: "HELD", holdUntil: hold, cancelableUntil: hold }));
    expect(held.key).toBe("w:8f3k2q1a-0000-0000-0000-000000000000");
    expect(held.cancelableUntil).toBe(hold.toISOString());
    const paid = withdrawalRow(withdrawal({ status: "PAID", holdUntil: hold, cancelableUntil: hold }));
    expect(paid.cancelableUntil).toBeNull();
    expect(paid.updatedAt).toBeNull();
  });

  it("makes a short reference from the id", () => {
    expect(referenceFor({ kind: "withdrawal", id: "8f3k2q1a-0000" })).toBe("WD-8F3K2Q1A");
    expect(referenceFor({ kind: "deposit", id: "1a2b3c4d-0000" })).toBe("DP-1A2B3C4D");
  });
});
