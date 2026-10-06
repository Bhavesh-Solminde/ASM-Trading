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
      "upi://pay?pa=asmtrade.demo1%40okaxis&pn=ASM%20Trade&am=991.01&cu=INR",
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
    expect(link).toContain("pn=ASM%20Trade%20%26%20Co");
  });

  it("adds a merchant code after the payee and a note at the end when given", () => {
    const link = buildUpiDeepLink({
      vpa: "shop@indus",
      payeeName: "Shop",
      amountInr: 100_347, // ₹1003.47
      merchantCode: "5411",
      note: "ASM-1a2b3c4d",
    });
    expect(link).toBe(
      "upi://pay?pa=shop%40indus&pn=Shop&mc=5411&am=1003.47&cu=INR&tn=ASM-1a2b3c4d",
    );
  });

  it("leaves out mc entirely when there is no merchant code", () => {
    const link = buildUpiDeepLink({ vpa: "a@b", payeeName: "X", amountInr: 100, merchantCode: null });
    expect(link).not.toContain("mc=");
  });
});
