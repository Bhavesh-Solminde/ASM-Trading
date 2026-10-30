import { describe, expect, it } from "vitest";
import { ApiErrorSchema, AppConfigSchema, CheckoutViewSchema, PreferencesUpdateSchema, WalletSchema, WithdrawalPrefillSchema, parsePaymentKey, paymentKeyOf } from "./app";

describe("app contracts", () => {
  it("accepts a wallet with live and demo accounts", () => {
    const wallet = {
      accounts: [
        { id: "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11", type: "LIVE", currency: "INR", realBalance: 150000, bonusBalance: 50000 },
        { id: "8e4d0b2f-4c66-4f9b-8b1c-7a5f3b2e1d22", type: "DEMO", currency: "INR", realBalance: 1000000, bonusBalance: 0 },
      ],
      withdrawable: 150000,
      lockedBonus: 50000,
      completedDeposits: 1,
      nextBonusPercent: 100,
      bonusTiers: [100, 100, 50, 50],
    };
    expect(WalletSchema.parse(wallet)).toEqual(wallet);
  });

  it("rejects an unknown locale", () => {
    expect(PreferencesUpdateSchema.safeParse({ locale: "fr" }).success).toBe(false);
    expect(PreferencesUpdateSchema.safeParse({ locale: "hi" }).success).toBe(true);
  });

  it("requires semver strings in app config", () => {
    const ok = {
      minVersion: "1.0.0",
      latestVersion: "1.2.0",
      apkUrl: "/download/app",
      playUrl: null,
      playLive: false,
      support: { whatsapp: null, telegram: null },
    };
    expect(AppConfigSchema.parse(ok)).toEqual(ok);
    expect(AppConfigSchema.safeParse({ ...ok, minVersion: "1.0" }).success).toBe(false);
  });

  it("describes errors with a stable code", () => {
    expect(ApiErrorSchema.parse({ error: "Not signed in.", code: "unauthenticated" }).code).toBe("unauthenticated");
  });

  describe("CheckoutViewSchema receipt fields", () => {
    const base = {
      id: "dep-1",
      method: "PhonePe",
      status: "COMPLETED",
      amountInr: 200000,
      amountUsdtMinor: null,
      network: null,
      expiresAt: "2026-10-21T10:05:00.000Z",
      upiUri: null,
      vpa: null,
      receivingAddress: null,
      isGateway: false,
      isSlot: false,
      claimedUtr: null,
      claimedTxHash: null,
      manualClaimDelaySec: 90,
    };

    it("still parses a response from an older server that has none of the new fields (they default to null)", () => {
      const view = CheckoutViewSchema.parse(base);
      expect(view.createdAt).toBeNull();
      expect(view.creditedAt).toBeNull();
      expect(view.creditedMinor).toBeNull();
      expect(view.creditedCurrency).toBeNull();
      expect(view.bonusMinor).toBeNull();
      expect(view.balanceAfterMinor).toBeNull();
      expect(view.utr).toBeNull();
    });

    it("carries the receipt when the server sends it", () => {
      const receipt = {
        createdAt: "2026-10-21T10:00:00.000Z",
        creditedAt: "2026-10-21T10:01:00.000Z",
        creditedMinor: 200000,
        creditedCurrency: "INR",
        bonusMinor: 200000,
        balanceAfterMinor: 1645000,
        utr: "428713905561",
      };
      expect(CheckoutViewSchema.parse({ ...base, ...receipt })).toMatchObject(receipt);
    });

    it("rejects a fractional money field", () => {
      expect(CheckoutViewSchema.safeParse({ ...base, creditedMinor: 1.5 }).success).toBe(false);
    });
  });

  describe("WithdrawalPrefillSchema held withdrawals", () => {
    const prefill = (held: unknown[]) => ({
      lastPayouts: {},
      initialMethod: null,
      kycName: "Asha Rao",
      kycStatus: "VERIFIED",
      heldWithdrawals: held,
    });

    it("carries each held withdrawal's cancel deadline", () => {
      const row = { id: "w-1", amountMinor: 500000, createdAt: "2026-10-20T08:00:00.000Z", cancelableUntil: "2026-10-20T20:00:00.000Z" };
      expect(WithdrawalPrefillSchema.parse(prefill([row])).heldWithdrawals).toEqual([row]);
    });

    it("leaves the deadline absent in a reply from an older server, so the app can tell it from a server saying there is none", () => {
      const parsed = WithdrawalPrefillSchema.parse(prefill([{ id: "w-1", amountMinor: 500000, createdAt: "2026-10-20T08:00:00.000Z" }]));
      expect(parsed.heldWithdrawals[0]?.cancelableUntil).toBeUndefined();
    });

    it("accepts an explicit null deadline and refuses a non-string one", () => {
      const base = { id: "w-1", amountMinor: 500000, createdAt: "2026-10-20T08:00:00.000Z" };
      expect(WithdrawalPrefillSchema.parse(prefill([{ ...base, cancelableUntil: null }])).heldWithdrawals[0]?.cancelableUntil).toBeNull();
      expect(WithdrawalPrefillSchema.safeParse(prefill([{ ...base, cancelableUntil: 5 }])).success).toBe(false);
    });
  });
});

describe("payment keys", () => {
  const id = "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11";

  it("reads a deposit and a withdrawal key", () => {
    expect(parsePaymentKey(`d:${id}`)).toEqual({ kind: "deposit", id });
    expect(parsePaymentKey(`w:${id}`)).toEqual({ kind: "withdrawal", id });
  });

  it("rejects anything else: other prefixes, a trade key, odd ids, empty, non-strings", () => {
    for (const bad of [`t:${id}`, `D:${id}`, `d:${id}x`, "d:", "d:abc", id, "", `d:${id}\n`, `d: ${id}`, undefined, null, 5]) {
      expect(parsePaymentKey(bad)).toBeNull();
    }
  });

  it("round-trips with paymentKeyOf", () => {
    expect(paymentKeyOf({ kind: "deposit", id })).toBe(`d:${id}`);
    expect(parsePaymentKey(paymentKeyOf({ kind: "withdrawal", id }))).toEqual({ kind: "withdrawal", id });
  });
});
