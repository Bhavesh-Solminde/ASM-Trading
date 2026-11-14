import { describe, expect, it } from "vitest";
import { formatSettingValue, parseIstDateTime, percentToBps, rupeesToPaise, settingValueFromInput } from "./parse";

describe("rupeesToPaise", () => {
  it("parses rupees to exact paise", () => {
    expect(rupeesToPaise("1999")).toBe(199_900);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1_999);
    expect(rupeesToPaise("₹1,23,456.78")).toBe(12_345_678);
    expect(rupeesToPaise("0.29")).toBe(29); // 0.29 * 100 is 28.999… in floats
  });
  it("accepts a sign only when asked", () => {
    expect(rupeesToPaise("-50")).toBeNull();
    expect(rupeesToPaise("-99.50", { signed: true })).toBe(-9_950);
    expect(rupeesToPaise("+5", { signed: true })).toBe(500);
  });
  it("rejects junk and over-precision", () => {
    for (const bad of ["", "abc", "1.234", "1e3", "1.", "--1"]) expect(rupeesToPaise(bad, { signed: true })).toBeNull();
  });
});

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
