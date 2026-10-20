import { describe, expect, it } from "vitest";
import { keypadModel } from "./keypad-model";

describe("keypadModel figure", () => {
  it("groups INR in lakhs and keeps the symbol", () => {
    expect(keypadModel("2500", "INR", 93, "en").figure).toBe("₹ 2,500");
    expect(keypadModel("1005010", "INR", 93, "en").figure).toBe("₹ 10,05,010");
  });
  it("shows 0 when empty", () => {
    expect(keypadModel("", "INR", 93, "en").figure).toBe("₹ 0");
  });
  it("keeps a typed decimal point on USD", () => {
    expect(keypadModel("1234.", "USD", 90, "en").figure).toBe("$ 1,234.");
    expect(keypadModel("1234.5", "USD", 90, "en").figure).toBe("$ 1,234.5");
  });
  it("shows a corrupt stored stake as typed, never a regrouped wrong number", () => {
    // groupTyped("1e308", "INR") would strip the "e" and read "1,308".
    expect(keypadModel("1e308", "INR", 93, "en").figure).toBe("₹ 1e308");
    expect(keypadModel("1e22", "INR", 93, "en").figure).toBe("₹ 1e22");
    expect(keypadModel("1e308", "USD", 93, "en").figure).toBe("$ 1e308");
  });
  it("shows a digits-only stake past the safe-integer range as stored (guards the isSafeInteger half)", () => {
    // Matches the digits-only pattern, but its paise value (2e21) is not a safe integer.
    expect(keypadModel("99999999999999999999", "INR", 93, "en").figure).toBe("₹ 99999999999999999999");
    expect(keypadModel("99999999999999999999", "INR", 93, "en").words).toBe("");
    expect(keypadModel("99999999999999999999", "INR", 93, "en").winMinor).toBeNull();
  });
  it("rejects a decimal point on INR, which has no decimals", () => {
    const m = keypadModel("100.5", "INR", 93, "en");
    expect(m.figure).toBe("₹ 100.5");
    expect(m.words).toBe("");
    expect(m.winMinor).toBeNull();
  });
  it("does not throw on a corrupt stake", () => {
    expect(() => keypadModel("1e308", "INR", 93, "hi")).not.toThrow();
    expect(() => keypadModel("abc", "USD", null, "en")).not.toThrow();
  });
});

describe("keypadModel words", () => {
  it("spells whole RUPEES, not paise (guards the 100x mistake)", () => {
    // stakeToMinor("100") is 10000 paise; passing that straight in would read "Ten thousand".
    expect(keypadModel("100", "INR", 93, "en").words).toBe("One hundred rupees only");
    expect(keypadModel("2500", "INR", 93, "en").words).toBe("Two thousand five hundred rupees only");
    expect(keypadModel("2500", "INR", 93, "hi").words).toBe("दो हज़ार पाँच सौ रुपये मात्र");
  });
  it("is empty on USD, on zero and on a corrupt stake", () => {
    expect(keypadModel("2500", "USD", 93, "en").words).toBe("");
    expect(keypadModel("", "INR", 93, "en").words).toBe("");
    expect(keypadModel("1e308", "INR", 93, "en").words).toBe("");
    expect(keypadModel("1e22", "INR", 93, "en").words).toBe("");
  });
});

describe("keypadModel winMinor", () => {
  it("is the stake plus the profit (₹4,825.00 for ₹2,500 at 93%)", () => {
    expect(keypadModel("2500", "INR", 93, "en").winMinor).toBe(482_500);
  });
  it("is null without a payout, without a stake, or with a corrupt stake", () => {
    expect(keypadModel("2500", "INR", null, "en").winMinor).toBeNull();
    expect(keypadModel("", "INR", 93, "en").winMinor).toBeNull();
    expect(keypadModel("1e308", "INR", 93, "en").winMinor).toBeNull();
  });
});
