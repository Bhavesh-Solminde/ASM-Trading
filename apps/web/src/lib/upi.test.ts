import { describe, expect, it } from "vitest";
import { buildUpiDeepLink } from "./upi";

describe("buildUpiDeepLink", () => {
  it("builds a upi:// deep link with the exact reserved amount pre-filled", () => {
    const link = buildUpiDeepLink({
      vpa: "asmtrade.demo1@okaxis",
      payeeName: "ASM Trade",
      amountInr: 99101, // ₹991.01
    });
    expect(link).toBe(
      "upi://pay?pa=asmtrade.demo1%40okaxis&pn=ASM+Trade&am=991.01&cu=INR",
    );
  });

  it("formats a whole-rupee amount with two decimal places", () => {
    const link = buildUpiDeepLink({
      vpa: "a@b",
      payeeName: "X",
      amountInr: 100000, // ₹1000.00
    });
    expect(link).toContain("am=1000.00");
  });

  it("percent-encodes special characters in the VPA and payee name", () => {
    const link = buildUpiDeepLink({
      vpa: "user.name@some-bank",
      payeeName: "ASM Trade & Co",
      amountInr: 100,
    });
    expect(link).toContain("pa=user.name%40some-bank");
    expect(link).toContain("pn=ASM+Trade+%26+Co");
  });
});
