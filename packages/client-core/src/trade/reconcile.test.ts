import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { RECONCILE_GRACE_SEC, RECONCILE_MIN_INTERVAL_SEC, shouldReconcile } from "./reconcile";

const trade = (over: Partial<TradeView> = {}): TradeView => ({
  id: "t1",
  accountId: "acct-live",
  symbol: "BTCUSDT",
  direction: "UP",
  stake: 10000,
  payoutPct: 85,
  entryPrice: 100,
  entryTs: 1_000,
  expiryTs: 1_010,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
  ...over,
});

describe("shouldReconcile", () => {
  it("stays quiet while an open trade's timer is still running", () => {
    expect(
      shouldReconcile({ trades: [trade()], nowSec: 1_005, lastAttemptSec: null }),
    ).toBe(false);
  });

  it("stays quiet in the grace window right after expiry, so the socket's own settlement wins", () => {
    expect(
      shouldReconcile({
        trades: [trade()],
        nowSec: 1_010 + RECONCILE_GRACE_SEC - 1,
        lastAttemptSec: null,
      }),
    ).toBe(false);
  });

  it("asks the server once the grace window passes with the trade still OPEN", () => {
    expect(
      shouldReconcile({
        trades: [trade()],
        nowSec: 1_010 + RECONCILE_GRACE_SEC,
        lastAttemptSec: null,
      }),
    ).toBe(true);
  });

  it("reconciles a trade whose settlement was missed while the socket was down", () => {
    // The engine settled this at 1_010 and pushed trade:settled to a socket
    // that was already gone; the tab comes back at 1_600 still holding OPEN.
    expect(
      shouldReconcile({ trades: [trade()], nowSec: 1_600, lastAttemptSec: null }),
    ).toBe(true);
  });

  it("never reconciles when every trade has already settled", () => {
    expect(
      shouldReconcile({
        trades: [trade({ status: "WON", exitPrice: 101, pnl: 8500 })],
        nowSec: 1_600,
        lastAttemptSec: null,
      }),
    ).toBe(false);
  });

  it("never reconciles with no trades at all", () => {
    expect(shouldReconcile({ trades: [], nowSec: 1_600, lastAttemptSec: null })).toBe(false);
  });

  it("throttles repeat attempts so a trade the engine left OPEN cannot hammer the API", () => {
    expect(
      shouldReconcile({
        trades: [trade()],
        nowSec: 1_600,
        lastAttemptSec: 1_600 - RECONCILE_MIN_INTERVAL_SEC + 1,
      }),
    ).toBe(false);
  });

  it("retries once the throttle interval has elapsed", () => {
    expect(
      shouldReconcile({
        trades: [trade()],
        nowSec: 1_600,
        lastAttemptSec: 1_600 - RECONCILE_MIN_INTERVAL_SEC,
      }),
    ).toBe(true);
  });

  it("looks at every trade, not just the newest", () => {
    const fresh = trade({ id: "t2", entryTs: 1_590, expiryTs: 1_650 });
    const stranded = trade({ id: "t1" });
    expect(
      shouldReconcile({ trades: [fresh, stranded], nowSec: 1_600, lastAttemptSec: null }),
    ).toBe(true);
  });
});
