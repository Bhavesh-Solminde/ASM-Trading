import { describe, expect, it } from "vitest";
import { methodLabel, receiptDate, receiptModel, receiptShareText, type ReceiptSource } from "./receipt-model";

const credited: ReceiptSource = {
  id: "1a2b3c4d-0000-0000-0000-000000000000",
  method: "PhonePe",
  amountInr: 200000,
  creditedAt: "2026-10-14T12:52:00.000Z",
  creditedMinor: 200000,
  creditedCurrency: "INR",
  bonusMinor: 200000,
  balanceAfterMinor: 1645000,
  utr: "428713905561",
};

describe("receiptDate", () => {
  it("reads dd Mon yyyy, HH:MM in the viewer's own time zone", () => {
    // 12:52 UTC is 18:22 in IST (UTC+05:30).
    expect(receiptDate("2026-10-14T12:52:00.000Z", 330)).toBe("14 Oct 2026, 18:22");
  });
  it("rolls the day over with the offset and pads the time", () => {
    expect(receiptDate("2026-12-31T20:05:00.000Z", 330)).toBe("01 Jan 2027, 01:35");
    expect(receiptDate("2026-03-05T03:04:00.000Z", 0)).toBe("05 Mar 2026, 03:04");
    expect(receiptDate("2026-03-05T03:04:00.000Z", -300)).toBe("04 Mar 2026, 22:04");
  });
  it("is null when the time cannot be read", () => {
    expect(receiptDate(null, 330)).toBeNull();
    expect(receiptDate("yesterday", 330)).toBeNull();
    expect(receiptDate("", 330)).toBeNull();
  });
});

describe("methodLabel", () => {
  it("names the UPI app, and keeps UPI and USDT as they are", () => {
    expect(methodLabel("PhonePe")).toBe("PhonePe UPI");
    expect(methodLabel("Gpay")).toBe("Google Pay UPI");
    expect(methodLabel("PayTM")).toBe("Paytm UPI");
    expect(methodLabel("UPI")).toBe("UPI");
    expect(methodLabel("USDT")).toBe("USDT");
  });
  it("shows a method the app does not know as the server sent it", () => {
    expect(methodLabel("Bank Transfer")).toBe("Bank Transfer");
  });
});

describe("receiptModel", () => {
  it("is the credited amount, bonus, balance, UTR, reference and local date", () => {
    expect(receiptModel(credited, { tzOffsetMin: 330 })).toEqual({
      amountMinor: 200000,
      currency: "INR",
      bonusMinor: 200000,
      balanceAfterMinor: 1645000,
      method: "PhonePe UPI",
      reference: "DP-1A2B3C4D",
      utr: "428713905561",
      dateText: "14 Oct 2026, 18:22",
    });
  });
  it("shows the credit in the account's own currency, not the INR the user paid", () => {
    const m = receiptModel({ ...credited, creditedMinor: 2400, creditedCurrency: "USD", bonusMinor: null, balanceAfterMinor: 2400 }, { tzOffsetMin: 0 });
    expect(m.amountMinor).toBe(2400);
    expect(m.currency).toBe("USD");
  });
  it("falls back to the INR amount asked for when an older server sent no credit", () => {
    const m = receiptModel({ ...credited, creditedMinor: null, creditedCurrency: null, bonusMinor: null, balanceAfterMinor: null, creditedAt: null, utr: null }, { tzOffsetMin: 0 });
    expect(m).toMatchObject({ amountMinor: 200000, currency: "INR", bonusMinor: null, balanceAfterMinor: null, utr: null, dateText: null });
  });
  it("hides a bonus of zero or less (gold is for a real bonus only)", () => {
    expect(receiptModel({ ...credited, bonusMinor: 0 }, { tzOffsetMin: 0 }).bonusMinor).toBeNull();
    expect(receiptModel({ ...credited, bonusMinor: -5 }, { tzOffsetMin: 0 }).bonusMinor).toBeNull();
    expect(receiptModel({ ...credited, bonusMinor: 1 }, { tzOffsetMin: 0 }).bonusMinor).toBe(1);
  });
  it("treats a blank UTR as none", () => {
    expect(receiptModel({ ...credited, utr: "  " }, { tzOffsetMin: 0 }).utr).toBeNull();
  });
});

describe("receiptShareText", () => {
  const labels = { title: "IndianxTrade deposit receipt", amount: "Amount", bonus: "Bonus", method: "Paid with", utr: "UTR", date: "Date", reference: "Reference" };
  it("is plain lines of label and value, with the amount through money()", () => {
    const text = receiptShareText(receiptModel(credited, { tzOffsetMin: 330 }), labels);
    expect(text).toBe(
      [
        "IndianxTrade deposit receipt",
        "Amount: ₹2,000.00",
        "Bonus: +₹2,000.00",
        "Paid with: PhonePe UPI",
        "UTR: 428713905561",
        "Date: 14 Oct 2026, 18:22",
        "Reference: DP-1A2B3C4D",
      ].join("\n"),
    );
  });
  it("leaves out what is not there: no bonus line at zero, no UTR, no date", () => {
    const m = receiptModel({ ...credited, bonusMinor: 0, utr: null, creditedAt: null }, { tzOffsetMin: 0 });
    const text = receiptShareText(m, labels);
    expect(text).not.toMatch(/Bonus|UTR|Date/);
    expect(text).toContain("Reference: DP-1A2B3C4D");
  });
});
