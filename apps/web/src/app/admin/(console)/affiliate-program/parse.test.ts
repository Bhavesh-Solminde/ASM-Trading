import { describe, expect, it } from "vitest";
import { formatSettingValue, parseIstDateTime, percentToBps, settingInputValue, settingValueFromInput } from "./parse";

describe("percentToBps", () => {
  it("converts percent to basis points exactly", () => {
    expect(percentToBps("5")).toBe(500);
    expect(percentToBps("12.5")).toBe(1_250);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("33.33%")).toBe(3_333);
  });
  it("rejects above 100%, negatives and too many decimals", () => {
    for (const bad of ["100.01", "-1", "1.234", "", "x"]) expect(percentToBps(bad)).toBeNull();
  });
});

describe("settings", () => {
  it("converts human units per key", () => {
    expect(settingValueFromInput("PROGRAM_MIN_WITHDRAWAL_INR_MINOR", "1999")).toBe(199_900);
    expect(settingValueFromInput("AFFILIATE_DEPOSIT_REWARD_BPS", "5.5")).toBe(550);
    expect(settingValueFromInput("DEFAULT_REVENUE_SHARE_BPS", "25.5")).toBe(2_550);
    expect(settingValueFromInput("DEFAULT_REVENUE_SHARE_BPS", "100.01")).toBeNull();
    expect(settingValueFromInput("INVITE_EXTRA_BONUS_PCT", "10")).toBe(10);
    expect(settingValueFromInput("INVITE_EXTRA_BONUS_PCT", "10.5")).toBeNull();
    expect(settingValueFromInput("PROGRAM_WITHDRAWALS_PER_DAY", "2")).toBe(2);
    expect(settingValueFromInput("AFFILIATE_REQUIRES_APPROVAL", "1")).toBe(1);
    expect(settingValueFromInput("AFFILIATE_REQUIRES_APPROVAL", "2")).toBeNull();
    expect(settingValueFromInput("NOPE", "1")).toBeNull();
  });
  it("formats stored values back", () => {
    expect(formatSettingValue("PROGRAM_MIN_WITHDRAWAL_INR_MINOR", 199_900)).toBe("₹1,999");
    expect(formatSettingValue("PROGRAM_MIN_WITHDRAWAL_INR_MINOR", 249_950)).toBe("₹2,499.50");
    expect(formatSettingValue("AFFILIATE_DEPOSIT_REWARD_BPS", 550)).toBe("5.5%");
    expect(formatSettingValue("AFFILIATE_REQUIRES_APPROVAL", 0)).toBe("Off");
    expect(formatSettingValue("DEFAULT_REVENUE_SHARE_BPS", 0)).toBe("0%");
    expect(formatSettingValue("DEFAULT_REVENUE_SHARE_BPS", 3_000)).toBe("30%");
  });
  it("prefills the edit form in the units it accepts, round-tripping exactly", () => {
    const cases: [string, number, string][] = [
      ["PROGRAM_MIN_WITHDRAWAL_INR_MINOR", 249_950, "2499.5"],
      ["DEFAULT_REVENUE_SHARE_BPS", 1_250, "12.5"],
      ["INVITE_EXTRA_BONUS_PCT", 10, "10"],
      ["PROGRAM_WITHDRAWALS_PER_DAY", 3, "3"],
      ["AFFILIATE_REQUIRES_APPROVAL", 1, "1"],
    ];
    for (const [key, stored, shown] of cases) {
      expect(settingInputValue(key, stored)).toBe(shown);
      expect(settingValueFromInput(key, shown)).toBe(stored);
    }
  });
});

describe("parseIstDateTime", () => {
  it("reads datetime-local as IST and defaults to now", () => {
    const now = new Date("2026-11-14T00:00:00Z");
    expect(parseIstDateTime("", now)).toBe(now);
    expect(parseIstDateTime("2026-11-15T05:30", now)?.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(parseIstDateTime("15/11/2026", now)).toBeNull();
  });
});
