import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { createGapTracker, shouldRefetchSettlements, WATCHDOG_MIN_INTERVAL_SEC } from "./settlement-watch";

const open = (expiryTs: number, id = "t"): TradeView => ({
  id,
  accountId: "a",
  symbol: "EURUSD",
  direction: "UP",
  stake: 10_000,
  payoutPct: 80,
  entryPrice: 1,
  entryTs: expiryTs - 30,
  expiryTs,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
});

describe("shouldRefetchSettlements", () => {
  it("waits while every open trade is inside its time (or the short grace after it)", () => {
    expect(shouldRefetchSettlements({ trades: [open(100)], nowSec: 99, lastAttemptSec: null })).toBe(false);
    expect(shouldRefetchSettlements({ trades: [open(100)], nowSec: 102, lastAttemptSec: null })).toBe(false);
  });
  it("asks once an open trade is past expiry plus grace", () => {
    expect(shouldRefetchSettlements({ trades: [open(100)], nowSec: 103, lastAttemptSec: null })).toBe(true);
  });
  it("is quiet with nothing open", () => {
    expect(shouldRefetchSettlements({ trades: [], nowSec: 1_000, lastAttemptSec: null })).toBe(false);
  });
  it("throttles repeats at the bootstrap-sized interval", () => {
    const trades = [open(100)];
    expect(shouldRefetchSettlements({ trades, nowSec: 120, lastAttemptSec: 120 - WATCHDOG_MIN_INTERVAL_SEC + 1 })).toBe(false);
    expect(shouldRefetchSettlements({ trades, nowSec: 120, lastAttemptSec: 120 - WATCHDOG_MIN_INTERVAL_SEC })).toBe(true);
  });
  it("uses an interval heavier than the web's per-account refetch (5s)", () => {
    expect(WATCHDOG_MIN_INTERVAL_SEC).toBeGreaterThan(5);
  });
});

describe("createGapTracker", () => {
  it("does not fire on the first authentication", () => {
    const gap = createGapTracker();
    expect(gap("connecting")).toBe(false);
    expect(gap("authed")).toBe(false);
  });
  it("fires once when authed returns after a disconnect", () => {
    const gap = createGapTracker();
    gap("authed");
    expect(gap("closed")).toBe(false);
    expect(gap("authed")).toBe(true);
    expect(gap("authed")).toBe(false);
  });
  it("does not fire for a drop that never authenticated before", () => {
    const gap = createGapTracker();
    gap("connecting");
    gap("closed");
    expect(gap("authed")).toBe(false);
  });
});
