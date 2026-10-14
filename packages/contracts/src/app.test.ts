import { describe, expect, it } from "vitest";
import { ApiErrorSchema, AppConfigSchema, PreferencesUpdateSchema, WalletSchema } from "./app";

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
});
