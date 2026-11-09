import { describe, expect, it } from "vitest";
import { finalEffects, FINAL_STATUSES, isFinalStatus, MIN_REFETCH_GAP_MS, POLL_INTERVAL_MS, pollIntervalMs, visibleRefetchDue } from "./checkout-poll";

describe("isFinalStatus", () => {
  it("is true for the three states a deposit never leaves", () => {
    for (const s of ["COMPLETED", "REJECTED", "EXPIRED"]) expect(isFinalStatus(s)).toBe(true);
    expect([...FINAL_STATUSES].sort()).toEqual(["COMPLETED", "EXPIRED", "REJECTED"]);
  });
  it("is false while the payment can still change, and for nothing", () => {
    expect(isFinalStatus("AWAITING_PAYMENT")).toBe(false);
    expect(isFinalStatus("PENDING_CONFIRMATION")).toBe(false);
    expect(isFinalStatus(undefined)).toBe(false);
    expect(isFinalStatus(null)).toBe(false);
    expect(isFinalStatus("")).toBe(false);
  });
});

describe("pollIntervalMs", () => {
  const base = { poll: true, status: "AWAITING_PAYMENT" as string | undefined, errorStatus: null as number | null };

  it("polls every 4 seconds while the screen is visible and the payment is open", () => {
    expect(POLL_INTERVAL_MS).toBe(4000);
    expect(pollIntervalMs(base)).toBe(4000);
    expect(pollIntervalMs({ ...base, status: "PENDING_CONFIRMATION" })).toBe(4000);
  });

  it("polls before the first answer has arrived (status unknown)", () => {
    expect(pollIntervalMs({ ...base, status: undefined })).toBe(4000);
  });

  it("stops when the screen is hidden, blurred, backgrounded or the session is locked (the caller folds all of them into `poll`)", () => {
    expect(pollIntervalMs({ ...base, poll: false })).toBe(false);
  });

  it("stops for good once the status is final", () => {
    for (const status of FINAL_STATUSES) expect(pollIntervalMs({ ...base, status })).toBe(false);
  });

  it("stops on a 4xx answer: the same request would only be answered the same way, and a 429 would toast every tick", () => {
    for (const errorStatus of [400, 403, 404, 429]) expect(pollIntervalMs({ ...base, errorStatus })).toBe(false);
  });

  it("keeps polling through a dropped connection, a timeout (status 0) or a 5xx, so it recovers by itself", () => {
    for (const errorStatus of [0, 500, 502, 503]) expect(pollIntervalMs({ ...base, errorStatus })).toBe(4000);
  });
});

describe("visibleRefetchDue", () => {
  const base = { wasVisible: false, visible: true, isFetching: false, lastFetchAtMs: 0, nowMs: 100_000 };

  it("asks for one refetch when the screen becomes visible again (focus back, or the app back in front)", () => {
    expect(visibleRefetchDue(base)).toBe(true);
  });

  it("does nothing while it stays visible or while it goes away", () => {
    expect(visibleRefetchDue({ ...base, wasVisible: true, visible: true })).toBe(false);
    expect(visibleRefetchDue({ ...base, wasVisible: true, visible: false })).toBe(false);
    expect(visibleRefetchDue({ ...base, wasVisible: false, visible: false })).toBe(false);
  });

  it("skips it while a fetch is already running (never cancel or double a request)", () => {
    expect(visibleRefetchDue({ ...base, isFetching: true })).toBe(false);
  });

  it("skips it when the data is only just in, so a quick focus flicker cannot stack requests", () => {
    expect(MIN_REFETCH_GAP_MS).toBeGreaterThanOrEqual(1000);
    expect(visibleRefetchDue({ ...base, lastFetchAtMs: base.nowMs - (MIN_REFETCH_GAP_MS - 1) })).toBe(false);
    expect(visibleRefetchDue({ ...base, lastFetchAtMs: base.nowMs - MIN_REFETCH_GAP_MS })).toBe(true);
  });

  it("is not thrown by a clock that went backwards", () => {
    expect(visibleRefetchDue({ ...base, lastFetchAtMs: base.nowMs + 5_000 })).toBe(false);
  });
});

describe("finalEffects", () => {
  it("runs the closing steps once when a final status first shows", () => {
    expect(finalEffects({ prev: "AWAITING_PAYMENT", next: "COMPLETED", handled: false })).toEqual({ run: true, haptic: true });
    expect(finalEffects({ prev: "PENDING_CONFIRMATION", next: "REJECTED", handled: false })).toEqual({ run: true, haptic: false });
    expect(finalEffects({ prev: "AWAITING_PAYMENT", next: "EXPIRED", handled: false })).toEqual({ run: true, haptic: false });
  });

  it("never runs them twice for the same payment", () => {
    expect(finalEffects({ prev: "AWAITING_PAYMENT", next: "COMPLETED", handled: true })).toEqual({ run: false, haptic: false });
  });

  it("does nothing while the payment is open or unknown", () => {
    expect(finalEffects({ prev: null, next: "AWAITING_PAYMENT", handled: false })).toEqual({ run: false, haptic: false });
    expect(finalEffects({ prev: null, next: null, handled: false })).toEqual({ run: false, haptic: false });
  });

  it("closes out a payment opened already final, but without the success buzz: the user did not just watch it land", () => {
    expect(finalEffects({ prev: null, next: "COMPLETED", handled: false })).toEqual({ run: true, haptic: false });
    expect(finalEffects({ prev: "COMPLETED", next: "COMPLETED", handled: false })).toEqual({ run: true, haptic: false });
  });
});
