import { describe, expect, it } from "vitest";
import { UsdtChainStatusSchema, usdtProgress, usdtProgressKey, usdtProgressWanted } from "./usdt-progress";

const credit = (finalityState: string, processingStatus: string) => ({ status: "AWAITING_PAYMENT", chainCredit: { finalityState, processingStatus } });

describe("usdtProgress", () => {
  it("is 'waiting' with nothing detected, before the first answer and for a null credit", () => {
    for (const data of [undefined, null, {}, { status: "AWAITING_PAYMENT", chainCredit: null }]) {
      expect(usdtProgress(data)).toEqual({ kind: "waiting", done: 0, detected: false });
    }
  });
  it("is 'detected' (1 of 3) for a transfer that is seen and not final yet", () => {
    expect(usdtProgress(credit("PENDING", "PENDING"))).toEqual({ kind: "detected", done: 1, detected: true });
    expect(usdtProgress(credit("UNCONFIRMED", "NEW"))).toEqual({ kind: "detected", done: 1, detected: true });
  });
  it("reads a credit with fields it does not know as detected, as the website does", () => {
    expect(usdtProgress({ chainCredit: {} }).kind).toBe("detected");
    expect(usdtProgress({ chainCredit: { finalityState: null, processingStatus: null } }).kind).toBe("detected");
  });
  it("is 'failed' for a transfer that failed or was reorged, and that wins over everything else", () => {
    expect(usdtProgress(credit("FAILED_ON_CHAIN", "PENDING"))).toEqual({ kind: "failed", done: 1, detected: true });
    expect(usdtProgress(credit("REORGED", "MANUAL_REVIEW")).kind).toBe("failed");
    expect(usdtProgress(credit("FAILED_ON_CHAIN", "DISMISSED")).kind).toBe("failed");
  });
  it("is 'dismissed' once the team reviewed and dismissed it", () => {
    expect(usdtProgress(credit("FINAL", "DISMISSED"))).toEqual({ kind: "dismissed", done: 2, detected: true });
  });
  it("is 'review' for a payment waiting on the team (manual review or no matching deposit)", () => {
    expect(usdtProgress(credit("FINAL", "MANUAL_REVIEW"))).toEqual({ kind: "review", done: 2, detected: true });
    expect(usdtProgress(credit("PENDING", "UNMATCHED")).kind).toBe("review");
  });
  it("is 'final' (confirmed, crediting) for a final transfer being processed", () => {
    expect(usdtProgress(credit("FINAL", "PENDING"))).toEqual({ kind: "final", done: 2, detected: true });
    expect(usdtProgress(credit("FINAL", "MATCHED")).kind).toBe("final");
  });
});

describe("usdtProgressKey", () => {
  it("has one translation key per state", () => {
    expect(usdtProgressKey("waiting")).toBeNull();
    expect(usdtProgressKey("detected")).toBe("usdt.progress.detected");
    expect(usdtProgressKey("final")).toBe("usdt.progress.final");
    expect(usdtProgressKey("review")).toBe("usdt.progress.review");
    expect(usdtProgressKey("dismissed")).toBe("usdt.progress.dismissed");
    expect(usdtProgressKey("failed")).toBe("usdt.progress.failed");
  });
});

describe("UsdtChainStatusSchema", () => {
  it("accepts the route's answer, and an answer with extra fields", () => {
    expect(UsdtChainStatusSchema.parse({ status: "AWAITING_PAYMENT", chainCredit: null })).toMatchObject({ chainCredit: null });
    const p = UsdtChainStatusSchema.parse({ status: "AWAITING_PAYMENT", chainCredit: { finalityState: "FINAL", processingStatus: "PENDING", confirmations: 3 }, extra: 1 });
    expect(p.chainCredit?.finalityState).toBe("FINAL");
  });
  it("never rejects a missing, null or odd field: it falls back to 'nothing detected'", () => {
    expect(UsdtChainStatusSchema.parse({})).toBeTruthy();
    expect(usdtProgress(UsdtChainStatusSchema.parse({ status: null, chainCredit: "oops" })).kind).toBe("waiting");
    expect(usdtProgress(UsdtChainStatusSchema.parse({ status: 7, chainCredit: { finalityState: 4, processingStatus: {} } })).kind).toBe("detected");
  });
});

describe("usdtProgressWanted", () => {
  it("asks only for a USDT payment whose checkout is still open", () => {
    expect(usdtProgressWanted({ method: "USDT", checkoutStatus: "AWAITING_PAYMENT" })).toBe(true);
    expect(usdtProgressWanted({ method: "USDT", checkoutStatus: "PENDING_CONFIRMATION" })).toBe(true);
  });
  it("never for UPI, for a final checkout, or before the checkout is known", () => {
    expect(usdtProgressWanted({ method: "UPI", checkoutStatus: "AWAITING_PAYMENT" })).toBe(false);
    for (const s of ["COMPLETED", "REJECTED", "EXPIRED"]) expect(usdtProgressWanted({ method: "USDT", checkoutStatus: s })).toBe(false);
    expect(usdtProgressWanted({ method: undefined, checkoutStatus: undefined })).toBe(false);
  });
});
