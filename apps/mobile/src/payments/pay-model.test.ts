import { describe, expect, it } from "vitest";
import { claimLinkVisible, claimReveal, countdownText, createAnchorStore, payInstrumentsVisible, pendingFromView, statusLineKey } from "./pay-model";

describe("countdownText", () => {
  const at = 1_800_000_000_000;
  it("counts down as mm:ss", () => {
    expect(countdownText(at + 582_000, at)).toBe("09:42");
    expect(countdownText(at + 59_000, at)).toBe("00:59");
    expect(countdownText(at + 60_000, at)).toBe("01:00");
  });
  it("shows a part-second as the second still to run, so 00:00 means it has run out", () => {
    expect(countdownText(at + 1, at)).toBe("00:01");
    expect(countdownText(at, at)).toBe("00:00");
  });
  it("keeps counting minutes past 59 (a UPI deposit lasts an hour)", () => {
    expect(countdownText(at + 3_600_000, at)).toBe("60:00");
  });
  it("holds at 00:00 after the deadline, and shows dashes for a time it cannot read", () => {
    expect(countdownText(at - 5_000, at)).toBe("00:00");
    expect(countdownText(Number.NaN, at)).toBe("--:--");
  });
});

describe("claimReveal", () => {
  it("hides the UTR link until the delay since the screen opened has passed", () => {
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000, delaySec: 90 })).toEqual({ revealed: false, remainingSec: 90 });
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000 + 89_001, delaySec: 90 })).toEqual({ revealed: false, remainingSec: 1 });
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000 + 90_000, delaySec: 90 })).toEqual({ revealed: true, remainingSec: 0 });
  });
  it("shows it at once when the server's delay is 0, and for a nonsense delay rather than hiding the way out for ever", () => {
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000, delaySec: 0 }).revealed).toBe(true);
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000, delaySec: -5 }).revealed).toBe(true);
    expect(claimReveal({ anchorMs: 1000, nowMs: 1000, delaySec: Number.NaN }).revealed).toBe(true);
  });
  it("cannot be held back longer than the delay by a clock that went backwards", () => {
    expect(claimReveal({ anchorMs: 50_000, nowMs: 1000, delaySec: 90 })).toEqual({ revealed: false, remainingSec: 90 });
  });
});

describe("claimLinkVisible", () => {
  it("shows the link only for an open payment with no UTR yet, once revealed", () => {
    expect(claimLinkVisible({ status: "AWAITING_PAYMENT", claimedUtr: null, revealed: true })).toBe(true);
  });
  it("hides it before the reveal, after a UTR was sent, and in every other status (the server refuses a claim then)", () => {
    expect(claimLinkVisible({ status: "AWAITING_PAYMENT", claimedUtr: null, revealed: false })).toBe(false);
    expect(claimLinkVisible({ status: "AWAITING_PAYMENT", claimedUtr: "412345678901", revealed: true })).toBe(false);
    for (const status of ["PENDING_CONFIRMATION", "COMPLETED", "REJECTED", "EXPIRED"]) {
      expect(claimLinkVisible({ status, claimedUtr: null, revealed: true })).toBe(false);
    }
  });
});

describe("statusLineKey", () => {
  it("has a line for each open status and none for a final one", () => {
    expect(statusLineKey("AWAITING_PAYMENT")).toBe("pay.waiting");
    expect(statusLineKey("PENDING_CONFIRMATION")).toBe("pay.gotUtr");
    expect(statusLineKey("COMPLETED")).toBeNull();
  });
});

describe("createAnchorStore", () => {
  it("anchors each payment on the first time it was opened, and keeps that when the screen is opened again", () => {
    const store = createAnchorStore();
    expect(store.anchorFor("tok-a", 1000)).toBe(1000);
    expect(store.anchorFor("tok-a", 9000)).toBe(1000);
    expect(store.anchorFor("tok-b", 9000)).toBe(9000);
  });
  it("forgets the oldest payments rather than growing for ever", () => {
    const store = createAnchorStore(2);
    store.anchorFor("a", 1);
    store.anchorFor("b", 2);
    store.anchorFor("c", 3);
    expect(store.anchorFor("a", 99)).toBe(99);
  });
});

describe("pendingFromView", () => {
  const view = { status: "AWAITING_PAYMENT", amountInr: 200_037, expiresAt: "2026-10-21T10:30:00.000Z" };
  const expiresAt = Date.parse(view.expiresAt);

  it("fills in the expiry and amount of the checkout the user started", () => {
    expect(pendingFromView({ existing: { token: "tok", expiresAt: null, amountInr: null }, token: "tok", view })).toEqual({ token: "tok", expiresAt, amountInr: 200_037 });
  });
  it("saves it when nothing was saved (the deposit screen's save failed, or this is a re-opened link)", () => {
    expect(pendingFromView({ existing: null, token: "tok", view })).toEqual({ token: "tok", expiresAt, amountInr: 200_037 });
  });
  it("leaves a newer deposit's saved checkout alone when an older payment's screen is open", () => {
    expect(pendingFromView({ existing: { token: "newer", expiresAt: null, amountInr: null }, token: "tok", view })).toBeNull();
  });
  it("saves nothing for a final payment (it is cleared instead) or an expiry it cannot read", () => {
    expect(pendingFromView({ existing: null, token: "tok", view: { ...view, status: "COMPLETED" } })).toBeNull();
    expect(pendingFromView({ existing: null, token: "tok", view: { ...view, expiresAt: "soon" } })).toBeNull();
  });
});

describe("payInstrumentsVisible", () => {
  it("shows the QR, UPI ID and app buttons only while the payment is open and no UTR has been sent", () => {
    expect(payInstrumentsVisible({ status: "AWAITING_PAYMENT", claimedUtr: null })).toBe(true);
  });
  it("hides them once a UTR is sent, so the screen cannot invite a second payment", () => {
    expect(payInstrumentsVisible({ status: "PENDING_CONFIRMATION", claimedUtr: "123456789012" })).toBe(false);
    expect(payInstrumentsVisible({ status: "PENDING_CONFIRMATION", claimedUtr: null })).toBe(false);
  });
  it("hides them on a claimed UTR even while the status still reads AWAITING_PAYMENT (the claim just landed)", () => {
    expect(payInstrumentsVisible({ status: "AWAITING_PAYMENT", claimedUtr: "123456789012" })).toBe(false);
  });
  it("hides them for any final status", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED"]) expect(payInstrumentsVisible({ status, claimedUtr: null })).toBe(false);
  });
});
