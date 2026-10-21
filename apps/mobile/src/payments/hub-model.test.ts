import { describe, expect, it } from "vitest";
import { hubBalances, pendingIsStale, pendingPaymentRow, pendingRowDecision, RECENT_LIMIT, showKycNextStep } from "./hub-model";

const live = { id: "live-1", currency: "INR", realBalance: 1_000_00, bonusBalance: 200_00 };

describe("hubBalances", () => {
  it("takes the total from the socket balance for the live account when it has one", () => {
    const b = hubBalances({ live, socket: { realBalance: 1_500_00, bonusBalance: 100_00 }, withdrawable: 1_000_00, lockedBonus: 200_00 });
    expect(b).toEqual({ currency: "INR", totalMinor: 1_600_00, withdrawableMinor: 1_000_00, bonusMinor: 100_00 });
  });
  it("falls back to the wallet when the socket has nothing for the account", () => {
    const b = hubBalances({ live, socket: undefined, withdrawable: 900_00, lockedBonus: 200_00 });
    expect(b).toEqual({ currency: "INR", totalMinor: 1_200_00, withdrawableMinor: 900_00, bonusMinor: 200_00 });
  });
  it("never shows more withdrawable than the real balance the socket reports", () => {
    const b = hubBalances({ live, socket: { realBalance: 400_00, bonusBalance: 0 }, withdrawable: 1_000_00, lockedBonus: 0 });
    expect(b?.withdrawableMinor).toBe(400_00);
  });
  it("shows the total before the wallet's own figures arrive, with those lines unknown", () => {
    const b = hubBalances({ live, socket: { realBalance: 500_00, bonusBalance: 0 }, withdrawable: undefined, lockedBonus: undefined });
    expect(b).toEqual({ currency: "INR", totalMinor: 500_00, withdrawableMinor: null, bonusMinor: 0 });
  });
  it("is null without a live account", () => {
    expect(hubBalances({ live: undefined, socket: undefined, withdrawable: 1, lockedBonus: 1 })).toBeNull();
  });
});

describe("showKycNextStep", () => {
  it("shows the verify card only before verification starts or after a rejection", () => {
    expect(showKycNextStep("NOT_STARTED")).toBe(true);
    expect(showKycNextStep("REJECTED")).toBe(true);
    expect(showKycNextStep("PENDING")).toBe(false);
    expect(showKycNextStep("VERIFIED")).toBe(false);
    expect(showKycNextStep(undefined)).toBe(false);
  });
});

describe("RECENT_LIMIT", () => {
  it("is 5", () => {
    expect(RECENT_LIMIT).toBe(5);
  });
});

describe("pendingPaymentRow", () => {
  const now = 1_800_000_000_000;
  it("offers the payment in progress, with its amount, while it has not run out", () => {
    expect(pendingPaymentRow({ token: "tok", expiresAt: now + 60_000, amountInr: 200_037 }, now)).toEqual({ token: "tok", amountInr: 200_037 });
  });
  it("offers it with no amount before the pay screen has loaded the checkout (expiry not known yet)", () => {
    expect(pendingPaymentRow({ token: "tok", expiresAt: null, amountInr: null }, now)).toEqual({ token: "tok", amountInr: null });
  });
  it("is nothing when there is no pending checkout", () => {
    expect(pendingPaymentRow(null, now)).toBeNull();
  });
  it("is nothing from the moment it expires: the row only ever leads to a payment that can still be made", () => {
    expect(pendingPaymentRow({ token: "tok", expiresAt: now + 1, amountInr: 1 }, now)).not.toBeNull();
    expect(pendingPaymentRow({ token: "tok", expiresAt: now, amountInr: 100 }, now)).toBeNull();
    expect(pendingPaymentRow({ token: "tok", expiresAt: now - 1, amountInr: 100 }, now)).toBeNull();
  });
});

describe("pendingIsStale", () => {
  const now = 1_800_000_000_000;
  it("is true only for a known expiry that has passed (then the saved checkout is cleared)", () => {
    expect(pendingIsStale({ token: "t", expiresAt: now - 1, amountInr: null }, now)).toBe(true);
    expect(pendingIsStale({ token: "t", expiresAt: now, amountInr: null }, now)).toBe(true);
    expect(pendingIsStale({ token: "t", expiresAt: now + 1, amountInr: null }, now)).toBe(false);
    expect(pendingIsStale({ token: "t", expiresAt: null, amountInr: null }, now)).toBe(false);
    expect(pendingIsStale(null, now)).toBe(false);
  });
});

describe("pendingRowDecision", () => {
  const now = 1_800_000_000_000;
  const saved = { token: "tok", expiresAt: now + 600_000, amountInr: 200_037 };
  const view = (over: Record<string, unknown> = {}) => ({ status: "AWAITING_PAYMENT", method: "PHONEPE", amountInr: 200_037, expiresAt: new Date(now + 600_000).toISOString(), ...over });
  const decide = (over: Partial<Parameters<typeof pendingRowDecision>[0]> = {}) => pendingRowDecision({ pending: saved, nowMs: now, view: view(), errorStatus: null, ...over });

  it("shows the row, with the server's amount and expiry, for an open UPI checkout", () => {
    expect(decide()).toEqual({ row: { token: "tok", amountInr: 200_037, expiresAt: now + 600_000 }, clear: false });
  });
  it("shows an open payment that was saved before the pay screen loaded it (no expiry, no amount) with the server's figures", () => {
    expect(decide({ pending: { token: "tok", expiresAt: null, amountInr: null } }).row).toEqual({ token: "tok", amountInr: 200_037, expiresAt: now + 600_000 });
  });
  it("is nothing, and clears nothing, when nothing is saved", () => {
    expect(decide({ pending: null, view: null })).toEqual({ row: null, clear: false });
  });
  it("hides the row until the server has answered, and keeps what is saved (offline or a 5xx is not an ending)", () => {
    expect(decide({ view: null })).toEqual({ row: null, clear: false });
    expect(decide({ view: null, errorStatus: 0 })).toEqual({ row: null, clear: false });
    expect(decide({ view: null, errorStatus: 503 })).toEqual({ row: null, clear: false });
  });
  it("clears on every final status", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED"]) expect(decide({ view: view({ status }) })).toEqual({ row: null, clear: true });
  });
  it("clears on a final status even for an entry whose expiry was never learned", () => {
    expect(decide({ pending: { token: "tok", expiresAt: null, amountInr: null }, view: view({ status: "COMPLETED" }) })).toEqual({ row: null, clear: true });
  });
  it("clears when the checkout is gone (404), even if an older answer is still cached", () => {
    expect(decide({ view: null, errorStatus: 404 })).toEqual({ row: null, clear: true });
    expect(decide({ errorStatus: 404 })).toEqual({ row: null, clear: true });
  });
  it("clears when the saved expiry has passed, before the server is asked", () => {
    expect(decide({ pending: { ...saved, expiresAt: now }, view: null })).toEqual({ row: null, clear: true });
  });
  it("clears when the server's own expiry has passed, for an entry with no saved expiry", () => {
    expect(decide({ pending: { token: "tok", expiresAt: null, amountInr: null }, view: view({ expiresAt: new Date(now - 1).toISOString() }) })).toEqual({ row: null, clear: true });
  });
  it("hides a USDT checkout (the app cannot pay it until T4) without forgetting it", () => {
    expect(decide({ view: view({ method: "USDT" }) })).toEqual({ row: null, clear: false });
  });
  it("hides, without clearing, when the server's expiry cannot be read (never invent an ending)", () => {
    expect(decide({ view: view({ expiresAt: "soon" }) }).clear).toBe(false);
  });
  it("shows a payment awaiting confirmation (UTR sent): it is still in progress", () => {
    expect(decide({ view: view({ status: "PENDING_CONFIRMATION" }) }).row).not.toBeNull();
  });
});
