import { describe, expect, it } from "vitest";
import { closedRowDisplay } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { ANNOUNCE_WINDOW_SEC, claimAnnouncement, settledFeedback } from "./result";

const ACCOUNT = "0b7d7e6e-5f0e-4c43-9a4f-2d3c1b0a9e11";
const OTHER = "9c1d7e6e-5f0e-4c43-9a4f-2d3c1b0a9e22";

const trade = (over: Partial<TradeView> = {}): TradeView => ({
  id: "t1",
  accountId: ACCOUNT,
  symbol: "EURUSD",
  direction: "UP",
  stake: 10_000,
  payoutPct: 80,
  entryPrice: 1,
  entryTs: 1_000,
  expiryTs: 1_030,
  exitPrice: 1.1,
  status: "WON",
  pnl: 8_000,
  ...over,
});

describe("settledFeedback", () => {
  it("celebrates a win with the gross return (what the trades list shows) and a success haptic", () => {
    expect(settledFeedback(trade(), "INR")).toEqual({
      tone: "up",
      key: "trade.won",
      amountMinor: 18_000,
      amountText: "₹180.00",
      haptic: "success",
    });
  });

  it("reports a loss with the stake and a warning haptic", () => {
    expect(settledFeedback(trade({ status: "LOST", pnl: -10_000 }), "INR")).toEqual({
      tone: "down",
      key: "trade.lost",
      amountMinor: 10_000,
      amountText: "₹100.00",
      haptic: "warning",
    });
  });

  it("treats a refund as neutral without a haptic", () => {
    expect(settledFeedback(trade({ status: "REFUNDED", pnl: 0, exitPrice: null }), "USD")).toEqual({
      tone: "neutral",
      key: "trade.refunded",
      amountMinor: 0,
      amountText: "$0.00",
      haptic: null,
    });
  });

  it("always shows the same number as the trades-list row", () => {
    for (const t of [trade(), trade({ status: "LOST", pnl: -10_000 }), trade({ status: "REFUNDED", pnl: 0 })]) {
      expect(settledFeedback(t, "INR").amountMinor).toBe(closedRowDisplay(t).amountMinor);
    }
  });
});

describe("claimAnnouncement", () => {
  const NOW = 1_040;
  const ctx = { accountId: ACCOUNT as string | null, nowSec: NOW };

  it("announces a fresh settlement on the selected account, once", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade(), ctx)).toBe(true);
    expect(claimAnnouncement(seen, trade(), ctx)).toBe(false);
  });

  it("stays silent for another account and never replays it after switching to that account", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade({ accountId: OTHER }), ctx)).toBe(false);
    expect(claimAnnouncement(seen, trade({ accountId: OTHER }), { ...ctx, accountId: OTHER })).toBe(false);
  });

  it("stays silent when no account is selected yet", () => {
    expect(claimAnnouncement(new Set(), trade(), { ...ctx, accountId: null })).toBe(false);
  });

  it("ignores a trade that is not settled", () => {
    expect(claimAnnouncement(new Set(), trade({ status: "OPEN", pnl: 0, exitPrice: null }), ctx)).toBe(false);
  });

  it("ignores a settlement that expired longer ago than the window (late or replayed delivery)", () => {
    const old = trade({ expiryTs: NOW - ANNOUNCE_WINDOW_SEC - 1 });
    expect(claimAnnouncement(new Set(), old, ctx)).toBe(false);
    expect(claimAnnouncement(new Set(), trade({ expiryTs: NOW - ANNOUNCE_WINDOW_SEC }), ctx)).toBe(true);
  });

  it("tolerates a device clock that runs behind the server", () => {
    expect(claimAnnouncement(new Set(), trade({ expiryTs: NOW + 300 }), ctx)).toBe(true);
  });

  it("announces different trades independently and forgets only the oldest ids past its cap", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade({ id: "a" }), ctx)).toBe(true);
    expect(claimAnnouncement(seen, trade({ id: "b" }), ctx)).toBe(true);
    for (let i = 0; i < 300; i += 1) claimAnnouncement(seen, trade({ id: `x${i}` }), ctx);
    expect(seen.size).toBeLessThanOrEqual(200);
    expect(claimAnnouncement(seen, trade({ id: "x299" }), ctx)).toBe(false);
  });
});
