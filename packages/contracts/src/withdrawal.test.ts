import { describe, expect, it } from "vitest";
import {
  CreateWithdrawalSchema,
  PayoutDetailsSchema,
  payoutDestinationKey,
  payoutDestinationLabel,
  withdrawalLimitsMinor,
} from "./withdrawal";

describe("withdrawalLimitsMinor", () => {
  it("is ₹700 – ₹50,000 on INR and $7 – $500 on USD", () => {
    expect(withdrawalLimitsMinor("INR")).toEqual({ min: 700_00, max: 50_000_00 });
    expect(withdrawalLimitsMinor("USD")).toEqual({ min: 7_00, max: 500_00 });
  });
});

describe("PayoutDetailsSchema", () => {
  it("normalises bank IFSC to upper case", () => {
    const p = PayoutDetailsSchema.parse({
      method: "BANK",
      accountHolder: " Asha Rao ",
      accountNumber: "001234567890",
      ifsc: "hdfc0001234",
    });
    expect(p).toEqual({ method: "BANK", accountHolder: "Asha Rao", accountNumber: "001234567890", ifsc: "HDFC0001234" });
  });

  it("refuses a short account number and a bad IFSC", () => {
    expect(
      PayoutDetailsSchema.safeParse({ method: "BANK", accountHolder: "A B", accountNumber: "1234", ifsc: "HDFC0001234" }).success,
    ).toBe(false);
    expect(
      PayoutDetailsSchema.safeParse({ method: "BANK", accountHolder: "A B", accountNumber: "123456789", ifsc: "HDFC1001234" }).success,
    ).toBe(false);
  });

  it("lower-cases a UPI ID and refuses one without a handle", () => {
    expect(PayoutDetailsSchema.parse({ method: "UPI", upiId: "Asha.Rao@OKICICI" })).toEqual({
      method: "UPI",
      upiId: "asha.rao@okicici",
    });
    expect(PayoutDetailsSchema.safeParse({ method: "UPI", upiId: "9876543210" }).success).toBe(false);
  });

  it("checks the USDT address against the chosen network", () => {
    const tron = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
    const bsc = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
    expect(PayoutDetailsSchema.safeParse({ method: "USDT", usdtNetwork: "tron", usdtAddress: tron }).success).toBe(true);
    expect(PayoutDetailsSchema.safeParse({ method: "USDT", usdtNetwork: "bsc", usdtAddress: bsc }).success).toBe(true);
    expect(PayoutDetailsSchema.safeParse({ method: "USDT", usdtNetwork: "tron", usdtAddress: bsc }).success).toBe(false);
    expect(PayoutDetailsSchema.safeParse({ method: "USDT", usdtNetwork: "bsc", usdtAddress: tron }).success).toBe(false);
  });

  it("refuses fields that belong to another method", () => {
    expect(PayoutDetailsSchema.safeParse({ method: "UPI", upiId: "a@ybl", ifsc: "HDFC0001234" }).success).toBe(false);
  });
});

describe("CreateWithdrawalSchema", () => {
  it("refuses the old method-label body", () => {
    expect(
      CreateWithdrawalSchema.safeParse({
        accountId: "8b1f7c5e-2b8a-4b8e-9a51-0e7f6a3f1c11",
        amount: 100_000,
        method: "PhonePe",
      }).success,
    ).toBe(false);
  });
});

describe("payoutDestinationKey / payoutDestinationLabel", () => {
  it("keys BSC addresses case-insensitively and TRON as-is", () => {
    expect(payoutDestinationKey({ method: "USDT", usdtNetwork: "bsc", usdtAddress: "0xABCdef0000000000000000000000000000000000" })).toBe(
      "usdt:bsc:0xabcdef0000000000000000000000000000000000",
    );
    expect(payoutDestinationKey({ method: "USDT", usdtNetwork: "tron", usdtAddress: "TAbc" })).toBe("usdt:tron:TAbc");
  });

  it("masks a bank account to its last four digits", () => {
    expect(payoutDestinationLabel({ method: "BANK", accountNumber: "001234567890", ifsc: "HDFC0001234" })).toBe(
      "HDFC0001234 ••7890",
    );
  });

  it("returns null for historical rows without details", () => {
    expect(payoutDestinationLabel({ method: "PhonePe" })).toBeNull();
  });
});
