import { describe, expect, it, vi } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  accountsNeedingTradeFetch,
  createGapTracker,
  needsBalanceFollowUp,
  runWatchdogTick,
  shouldRefetchSettlements,
  WATCHDOG_MIN_INTERVAL_SEC,
} from "./settlement-watch";

const open = (expiryTs: number, id = "t", accountId = "a"): TradeView => ({
  id,
  accountId,
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
  it("does not treat a deliberate stop (idle) followed by a restart as a drop", () => {
    const gap = createGapTracker();
    gap("authed");
    expect(gap("idle")).toBe(false); // app went to the background on purpose
    gap("connecting");
    expect(gap("authed")).toBe(false); // the foreground refresh already covers it
  });
  it("still fires for a drop that happens after such a restart", () => {
    const gap = createGapTracker();
    gap("authed");
    gap("idle");
    gap("connecting");
    gap("authed");
    gap("closed");
    expect(gap("authed")).toBe(true);
  });
  it("a deliberate stop cancels a drop recorded just before it", () => {
    const gap = createGapTracker();
    gap("authed");
    gap("closed");
    gap("idle");
    gap("connecting");
    expect(gap("authed")).toBe(false);
  });
});

describe("needsBalanceFollowUp", () => {
  it("is true once for each newly published, non-empty batch of accounts", () => {
    const none: readonly string[] = [];
    const batch: readonly string[] = ["a"];
    expect(needsBalanceFollowUp(none, batch)).toBe(true);
    expect(needsBalanceFollowUp(batch, batch)).toBe(false);
    expect(needsBalanceFollowUp(batch, ["a"])).toBe(true);
  });

  it("is false when nothing is pending", () => {
    expect(needsBalanceFollowUp(["a"], [])).toBe(false);
    expect(needsBalanceFollowUp([], [])).toBe(false);
  });
});

describe("accountsNeedingTradeFetch", () => {
  it("names accounts the bootstrap does not carry that hold an overdue open trade", () => {
    const trades = [open(100, "d1", "demo"), open(100, "l1", "live")];
    expect(accountsNeedingTradeFetch({ trades, nowSec: 103, bootstrapAccountId: "demo" })).toEqual(["live"]);
  });
  it("is empty while the trade is inside its time, or when only the bootstrap account is overdue", () => {
    expect(accountsNeedingTradeFetch({ trades: [open(100, "l1", "live")], nowSec: 102, bootstrapAccountId: "demo" })).toEqual([]);
    expect(accountsNeedingTradeFetch({ trades: [open(100, "d1", "demo")], nowSec: 500, bootstrapAccountId: "demo" })).toEqual([]);
  });
  it("lists each account once, and ignores settled trades", () => {
    const settled = { ...open(100, "l3", "live"), status: "WON" as const };
    const trades = [open(100, "l1", "live"), open(90, "l2", "live"), settled, open(100, "x1", "other")];
    expect(accountsNeedingTradeFetch({ trades, nowSec: 500, bootstrapAccountId: "demo" })).toEqual(["live", "other"]);
  });
  it("treats every account as uncarried while the bootstrap account is unknown", () => {
    expect(accountsNeedingTradeFetch({ trades: [open(100, "d1", "demo")], nowSec: 500, bootstrapAccountId: undefined })).toEqual(["demo"]);
  });
});

describe("runWatchdogTick", () => {
  const make = () => ({ refreshBootstrap: vi.fn(), fetchTrades: vi.fn() });

  it("an overdue LIVE trade refetches that account's trades (bootstrap cannot settle it), plus the bootstrap", () => {
    const d = make();
    const last = runWatchdogTick({ trades: [open(100, "l1", "live")], nowSec: 103, lastAttemptSec: null, bootstrapAccountId: "demo", ...d });
    expect(d.fetchTrades).toHaveBeenCalledTimes(1);
    expect(d.fetchTrades).toHaveBeenCalledWith("live");
    expect(d.refreshBootstrap).toHaveBeenCalledTimes(1);
    expect(last).toBe(103);
  });
  it("an overdue bootstrap-account trade only refreshes the bootstrap", () => {
    const d = make();
    runWatchdogTick({ trades: [open(100, "d1", "demo")], nowSec: 103, lastAttemptSec: null, bootstrapAccountId: "demo", ...d });
    expect(d.fetchTrades).not.toHaveBeenCalled();
    expect(d.refreshBootstrap).toHaveBeenCalledTimes(1);
  });
  it("does nothing, and keeps the last attempt, inside the throttle or with nothing overdue", () => {
    const d = make();
    expect(runWatchdogTick({ trades: [open(100, "l1", "live")], nowSec: 105, lastAttemptSec: 100, bootstrapAccountId: "demo", ...d })).toBe(100);
    expect(runWatchdogTick({ trades: [open(100, "l1", "live")], nowSec: 99, lastAttemptSec: null, bootstrapAccountId: "demo", ...d })).toBeNull();
    expect(d.fetchTrades).not.toHaveBeenCalled();
    expect(d.refreshBootstrap).not.toHaveBeenCalled();
  });
});
