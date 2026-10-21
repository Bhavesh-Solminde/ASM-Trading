import { describe, expect, it } from "vitest";
import { amountText, endedNoteKey, endedUsdtLink, payScreenFor, payTitleAmount, requestedAmount, showsSupportLink } from "./result-model";

describe("payScreenFor", () => {
  it("shows the way to pay while the payment is open", () => {
    expect(payScreenFor("AWAITING_PAYMENT")).toBe("pay");
  });
  it("shows 'checking' once the UTR is in and we are confirming", () => {
    expect(payScreenFor("PENDING_CONFIRMATION")).toBe("pending");
  });
  it("shows the receipt only for a credited payment", () => {
    expect(payScreenFor("COMPLETED")).toBe("receipt");
  });
  it("shows the ended frame for rejected and expired", () => {
    expect(payScreenFor("REJECTED")).toBe("ended");
    expect(payScreenFor("EXPIRED")).toBe("ended");
  });
  it("never shows a receipt for a status it does not know", () => {
    expect(payScreenFor("SOMETHING_NEW")).toBe("pay");
  });
});

describe("endedNoteKey", () => {
  it("says a late UPI payment is still credited, and not to pay twice", () => {
    expect(endedNoteKey({ status: "EXPIRED", isGateway: false })).toBe("pay.ended.expired");
  });
  it("says the gateway credits a late USDT payment by itself", () => {
    expect(endedNoteKey({ status: "EXPIRED", isGateway: true })).toBe("pay.ended.expiredGateway");
  });
  it("tells a non-gateway USDT deposit not to send to the address any more (a slot address passes to another user)", () => {
    expect(endedNoteKey({ status: "EXPIRED", isGateway: false, isUsdt: true })).toBe("pay.ended.expiredUsdt");
    expect(endedNoteKey({ status: "EXPIRED", isGateway: true, isUsdt: true })).toBe("pay.ended.expiredGateway");
    expect(endedNoteKey({ status: "EXPIRED", isGateway: false, isUsdt: false })).toBe("pay.ended.expired");
    expect(endedNoteKey({ status: "REJECTED", isGateway: false, isUsdt: true })).toBe("pay.ended.rejected");
  });
  it("says a rejected deposit was not approved, gateway or not", () => {
    expect(endedNoteKey({ status: "REJECTED", isGateway: false })).toBe("pay.ended.rejected");
    expect(endedNoteKey({ status: "REJECTED", isGateway: true })).toBe("pay.ended.rejected");
  });
});

describe("showsSupportLink", () => {
  it("offers support for a rejection only: an expired payment has nothing to appeal, and no claim link (the claim route takes only an open one)", () => {
    expect(showsSupportLink("REJECTED")).toBe(true);
    expect(showsSupportLink("EXPIRED")).toBe(false);
    expect(showsSupportLink("COMPLETED")).toBe(false);
  });
});

describe("requestedAmount / amountText", () => {
  it("an INR deposit is its rupees", () => {
    const a = requestedAmount({ method: "UPI", amountInr: 200000, amountUsdtMinor: null });
    expect(a).toEqual({ minor: 200000, currency: "INR" });
    expect(amountText(a.minor, a.currency)).toBe("₹2,000.00");
  });

  it("a USDT deposit is its USDT, never the negative rupee figure the server stores for it", () => {
    const a = requestedAmount({ method: "USDT", amountInr: -2000, amountUsdtMinor: 2000 });
    expect(a).toEqual({ minor: 2000, currency: "USDT" });
    expect(amountText(a.minor, a.currency)).toBe("20.00 USDT");
  });

  it("a USDT deposit from an older server without amountUsdtMinor uses the magnitude", () => {
    expect(requestedAmount({ method: "USDT", amountInr: -2000, amountUsdtMinor: null })).toEqual({ minor: 2000, currency: "USDT" });
  });
});

describe("payTitleAmount", () => {
  it("is the rupees, trimmed when whole, for a UPI payment", () => {
    expect(payTitleAmount({ method: "UPI", amountInr: 193_000, amountUsdtMinor: null })).toBe("₹1,930");
    expect(payTitleAmount({ method: "PhonePe", amountInr: 200_037, amountUsdtMinor: null })).toBe("₹2,000.37");
  });
  it("is the USDT, with its unit, for a USDT payment: never the negative rupee figure the server stores", () => {
    expect(payTitleAmount({ method: "USDT", amountInr: -2000, amountUsdtMinor: 2000 })).toBe("20.00 USDT");
    expect(payTitleAmount({ method: "USDT", amountInr: -123_456, amountUsdtMinor: 123_456 })).toBe("1,234.56 USDT");
  });
});

describe("endedUsdtLink", () => {
  const expired = { method: "USDT", isGateway: false, status: "EXPIRED" };
  it("offers the tx-hash claim on an expired manual USDT deposit, as the website does", () => {
    expect(endedUsdtLink(expired)).toBe("claim");
  });
  it("sends an expired gateway deposit to support with its hash (it lands in review by itself)", () => {
    expect(endedUsdtLink({ ...expired, isGateway: true })).toBe("support");
  });
  it("offers nothing on a rejected USDT deposit (the server takes no claim), a credited one, or a UPI one", () => {
    expect(endedUsdtLink({ ...expired, status: "REJECTED" })).toBeNull();
    expect(endedUsdtLink({ ...expired, status: "COMPLETED" })).toBeNull();
    expect(endedUsdtLink({ ...expired, method: "UPI" })).toBeNull();
  });
});
