import { describe, expect, it } from "vitest";
import { getProgramSettings, PROGRAM_SETTING_KEYS, settingsAt } from "./program-settings";

const d = (iso: string) => new Date(iso);
const epoch = d("1970-01-01T00:00:00Z");
const base = PROGRAM_SETTING_KEYS.map((key, i) => ({ id: `base-${i}`, key, value: 100 + i, effectiveFrom: epoch, createdAt: epoch }));

describe("settingsAt", () => {
  it("picks the latest version effective at T, per key", () => {
    const rows = [
      ...base,
      { id: "v2", key: "USER_REFERRAL_REWARD_INR_MINOR" as const, value: 7000, effectiveFrom: d("2027-01-01T00:00:00Z"), createdAt: d("2026-12-01T00:00:00Z") },
      { id: "v3", key: "USER_REFERRAL_REWARD_INR_MINOR" as const, value: 9000, effectiveFrom: d("2027-06-01T00:00:00Z"), createdAt: d("2026-12-02T00:00:00Z") },
    ];
    expect(settingsAt(rows, d("2026-12-31T23:59:59Z")).values.USER_REFERRAL_REWARD_INR_MINOR).toBe(102);
    const jan = settingsAt(rows, d("2027-01-01T00:00:00Z"));
    expect(jan.values.USER_REFERRAL_REWARD_INR_MINOR).toBe(7000);
    expect(jan.ids.USER_REFERRAL_REWARD_INR_MINOR).toBe("v2");
    expect(jan.values.MIN_QUALIFYING_DEPOSIT_INR_MINOR).toBe(100); // other keys unaffected
    expect(settingsAt(rows, d("2028-01-01T00:00:00Z")).ids.USER_REFERRAL_REWARD_INR_MINOR).toBe("v3");
  });

  it("breaks an effectiveFrom tie by the later-created row", () => {
    const at = d("2027-01-01T00:00:00Z");
    const rows = [
      ...base,
      { id: "old", key: "INVITE_EXTRA_BONUS_PCT" as const, value: 5, effectiveFrom: at, createdAt: d("2026-01-01T00:00:00Z") },
      { id: "new", key: "INVITE_EXTRA_BONUS_PCT" as const, value: 15, effectiveFrom: at, createdAt: d("2026-02-01T00:00:00Z") },
    ];
    expect(settingsAt(rows, at).values.INVITE_EXTRA_BONUS_PCT).toBe(15);
  });

  it("throws when a key has no version in force", () => {
    expect(() => settingsAt(base.slice(1), d("2027-01-01T00:00:00Z"))).toThrow(/MIN_QUALIFYING_DEPOSIT_INR_MINOR/);
  });
});

describe("getProgramSettings", () => {
  it("returns the migration's launch defaults with their row ids", async () => {
    const s = await getProgramSettings(new Date());
    expect(s.values).toEqual({
      MIN_QUALIFYING_DEPOSIT_INR_MINOR: 50_000,
      MIN_QUALIFYING_TRADE_INR_MINOR: 10_000,
      USER_REFERRAL_REWARD_INR_MINOR: 5_000,
      AFFILIATE_DEPOSIT_REWARD_BPS: 500,
      INVITE_EXTRA_BONUS_PCT: 10,
    });
    for (const key of PROGRAM_SETTING_KEYS) expect(s.ids[key]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
