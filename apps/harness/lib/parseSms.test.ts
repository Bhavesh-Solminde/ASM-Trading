import { describe, expect, it } from "vitest";
import { parseSms } from "./parseSms";

describe("parseSms", () => {
  it("returns null when no amount is present", () => {
    expect(parseSms("Your OTP is 482913. Do not share it with anyone.")).toBeNull();
  });

  it("parses a currency-prefixed credit with a labelled reference", () => {
    const body =
      "Dear Customer, Rs.500.00 credited to A/c XX1234 on 01-Jan-24. Ref No: 123456789012. Avl Bal Rs.10,500.00";
    expect(parseSms(body)).toEqual({
      amountInr: 50000,
      utr: "123456789012",
      isCredit: true,
    });
  });

  it("prefers the first amount over a trailing available-balance figure", () => {
    const body = "Rs.500.00 debited from A/c XX1234. Avl Bal: Rs.10,000.00";
    expect(parseSms(body)?.amountInr).toBe(50000);
  });

  it("parses a bare two-decimal amount with no currency prefix", () => {
    const body =
      "Dear UPI user A/C X8126 debited by 1.00 on date 12Sep26 trf to BHAVESH SHIVAJI Refno 625503519433";
    expect(parseSms(body)).toEqual({
      amountInr: 100,
      utr: "625503519433",
      isCredit: false,
    });
  });

  it("falls back to a bare long digit sequence when no labelled reference exists", () => {
    const body = "Rs.50.00 credited. Txn ref 987654321012 successful.";
    expect(parseSms(body)?.utr).toBe("987654321012");
  });

  it("returns a null UTR when no reference number is present", () => {
    expect(parseSms("Rs.50.00 credited to your account.")?.utr).toBeNull();
  });

  it("treats a message mentioning both credit and debit keywords as not a credit", () => {
    const body = "Rs.50.00 debited; refund will be credited within 5 days.";
    expect(parseSms(body)?.isCredit).toBe(false);
  });

  it("does not mistake a bare integer for an amount", () => {
    expect(parseSms("Your account balance is 5000. No recent transactions.")).toBeNull();
  });
});
