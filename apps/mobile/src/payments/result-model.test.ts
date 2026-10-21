import { describe, expect, it } from "vitest";
import { amountText, endedNoteKey, payScreenFor, requestedAmount, showsSupportLink } from "./result-model";

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
