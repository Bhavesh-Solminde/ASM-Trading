import { describe, expect, it } from "vitest";
import { parseBankSms } from "./parse-bank-sms";

describe("parseBankSms", () => {
  it("returns null when no amount is present", () => {
    expect(parseBankSms("Your OTP is 482913. Do not share it with anyone.")).toBeNull();
  });

  it("parses a currency-prefixed credit with a labelled reference", () => {
    const body =
      "Dear Customer, Rs.500.00 credited to A/c XX1234 on 01-Jan-24. Ref No: 123456789012. Avl Bal Rs.10,500.00";
    expect(parseBankSms(body)).toEqual({
      amountInr: 50000,
      utr: "123456789012",
      isCredit: true,
    });
  });

  it("prefers the first amount over a trailing available-balance figure", () => {
    const body = "Rs.500.00 debited from A/c XX1234. Avl Bal: Rs.10,000.00";
    expect(parseBankSms(body)?.amountInr).toBe(50000);
  });

  it("parses a bare two-decimal amount with no currency prefix", () => {
    const body =
      "Dear UPI user A/C X8126 debited by 1.00 on date 12Sep26 trf to BHAVESH SHIVAJI Refno 625503519433";
    expect(parseBankSms(body)).toEqual({
      amountInr: 100,
      utr: "625503519433",
      isCredit: false,
    });
  });

  it("falls back to a bare long digit sequence when no labelled reference exists", () => {
    const body = "Rs.50.00 credited. Txn ref 987654321012 successful.";
    expect(parseBankSms(body)?.utr).toBe("987654321012");
  });

  it("returns a null UTR when no reference number is present", () => {
    expect(parseBankSms("Rs.50.00 credited to your account.")?.utr).toBeNull();
  });

  it("treats a message mentioning both credit and debit keywords as not a credit", () => {
    const body = "Rs.50.00 debited; refund will be credited within 5 days.";
    expect(parseBankSms(body)?.isCredit).toBe(false);
  });

  it("does not mistake a bare integer for an amount", () => {
    expect(parseBankSms("Your account balance is 5000. No recent transactions.")).toBeNull();
  });

  // Not an SMS, but the same parser handles PhonePe notification text
  // forwarded from the notification listener. The real format (verified
  // against a live PhonePe notification screenshot): "Rs" with no decimal,
  // and the reference is prefixed with the bare word "txn" (no "id" after
  // it) and runs 23 chars starting with a letter. Both the label widening
  // ("txn" alone) and the length widening (>22 chars, alphanumeric) are
  // the specific carve-outs that make this parse at all.
  it("parses a real PhonePe credit notification (title | big-text) as a credit", () => {
    const body =
      "Received Rs 1 | You've received Rs 1 from ******4892 via PhonePe for txn T2610070038436427054415.";
    expect(parseBankSms(body)).toEqual({
      amountInr: 100,
      utr: "T2610070038436427054415",
      isCredit: true,
    });
  });

  // The actual PhonePe Business SMS from sender "AX-PHONEPE-S", verified
  // against a live message screenshot. Note the reference comes after a
  // bare "for" (no "txn"/"utr"/"ref" label at all), is 23 chars, starts
  // with "T", and the amount is "Rs 1" with no decimal. The letter-prefix
  // branch of BARE_REF_RE is what catches this.
  it("parses a real PhonePe Business credit SMS as a credit", () => {
    const body =
      "Rs 1 received from ******4892 on Oct 07 2026, 1:52 AM for T2610070152259856476787 via PhonePe.";
    expect(parseBankSms(body)).toEqual({
      amountInr: 100,
      utr: "T2610070152259856476787",
      isCredit: true,
    });
  });
});
