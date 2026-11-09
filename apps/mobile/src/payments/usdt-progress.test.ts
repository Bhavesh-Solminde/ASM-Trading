import { describe, expect, it } from "vitest";
import { UsdtChainStatusSchema, usdtClockShown, usdtDeadlineStep, usdtLapsed, usdtProgress, usdtProgressKey, usdtProgressWanted, usdtShowsSupport } from "./usdt-progress";

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

const DEADLINE = "2026-10-21T10:05:00.000Z";
const deadlineMs = Date.parse(DEADLINE);
const waiting = usdtProgress(null);
const seen = (finality: string, processing: string) => usdtProgress(credit(finality, processing));

describe("usdtLapsed", () => {
  it("is false before the deadline and true from the deadline on, with nothing detected", () => {
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs - 1, progress: waiting })).toBe(false);
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs, progress: waiting })).toBe(true);
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs + 3_600_000, progress: waiting })).toBe(true);
  });
  it("never ends a transfer that was seen: detected, final, review and dismissed stay on the pay screen", () => {
    for (const progress of [seen("PENDING", "PENDING"), seen("FINAL", "PENDING"), seen("FINAL", "MANUAL_REVIEW"), seen("PENDING", "UNMATCHED"), seen("FINAL", "DISMISSED")]) {
      expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs + 1000, progress })).toBe(false);
    }
  });
  it("treats a failed or reorged transfer as nothing detected: the window is over and a resend would be late", () => {
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs + 1000, progress: seen("FAILED_ON_CHAIN", "PENDING") })).toBe(true);
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: deadlineMs + 1000, progress: seen("REORGED", "PENDING") })).toBe(true);
  });
  it("is false when the deadline cannot be read, so a bad answer never hides the way to pay", () => {
    for (const expiresAt of ["", "soon", "NaN"]) {
      expect(usdtLapsed({ expiresAt, nowMs: deadlineMs + 1000, progress: waiting })).toBe(false);
    }
    expect(usdtLapsed({ expiresAt: DEADLINE, nowMs: Number.NaN, progress: waiting })).toBe(false);
  });
});

describe("usdtDeadlineStep", () => {
  const base = { expiresAt: DEADLINE, enabled: true };
  it("arms one timer for the time left while the deadline is ahead", () => {
    expect(usdtDeadlineStep({ ...base, nowMs: deadlineMs - 90_000 })).toEqual({ kind: "arm", delayMs: 90_000 });
  });
  it("checks at once when the deadline has already passed (a resume after the app was in the background)", () => {
    expect(usdtDeadlineStep({ ...base, nowMs: deadlineMs })).toEqual({ kind: "check" });
    expect(usdtDeadlineStep({ ...base, nowMs: deadlineMs + 7_200_000 })).toEqual({ kind: "check" });
  });
  it("does nothing when it is switched off (hidden, backgrounded, not a USDT open checkout) or the deadline is unreadable", () => {
    expect(usdtDeadlineStep({ ...base, enabled: false, nowMs: deadlineMs - 1000 })).toEqual({ kind: "none" });
    expect(usdtDeadlineStep({ ...base, enabled: false, nowMs: deadlineMs + 1000 })).toEqual({ kind: "none" });
    expect(usdtDeadlineStep({ expiresAt: "soon", enabled: true, nowMs: deadlineMs })).toEqual({ kind: "none" });
  });
  it("caps the delay below the timer limit, so a far deadline never fires at once", () => {
    const step = usdtDeadlineStep({ ...base, nowMs: deadlineMs - 40 * 86_400_000 });
    expect(step.kind).toBe("arm");
    if (step.kind === "arm") expect(step.delayMs).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe("usdtClockShown", () => {
  it("shows the header clock while waiting and for a failed transfer (the window is still open for a resend)", () => {
    expect(usdtClockShown(waiting)).toBe(true);
    expect(usdtClockShown(seen("FAILED_ON_CHAIN", "PENDING"))).toBe(true);
    expect(usdtClockShown(seen("REORGED", "PENDING"))).toBe(true);
  });
  it("hides it once a transfer is seen and not failed, as the website does", () => {
    for (const progress of [seen("PENDING", "PENDING"), seen("FINAL", "PENDING"), seen("FINAL", "MANUAL_REVIEW"), seen("FINAL", "DISMISSED")]) {
      expect(usdtClockShown(progress)).toBe(false);
    }
  });
});

describe("usdtShowsSupport", () => {
  it("offers support where the status line itself sends the user to the team", () => {
    expect(usdtShowsSupport("dismissed")).toBe(true);
    expect(usdtShowsSupport("review")).toBe(true);
    expect(usdtShowsSupport("failed")).toBe(true);
  });
  it("does not clutter the ordinary states", () => {
    expect(usdtShowsSupport("waiting")).toBe(false);
    expect(usdtShowsSupport("detected")).toBe(false);
    expect(usdtShowsSupport("final")).toBe(false);
  });
});
