import { describe, expect, it } from "vitest";
import { closedRowDisplay } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { claimAnnouncement, newlySettled, settledFeedback } from "./result";

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

  it("states the stake that came back on a refund, with no haptic", () => {
    expect(settledFeedback(trade({ status: "REFUNDED", pnl: 0, exitPrice: null }), "INR")).toEqual({
      tone: "neutral",
      key: "trade.refunded",
      amountMinor: 10_000,
      amountText: "₹100.00",
      haptic: null,
    });
  });

  it("shows a win and a loss with the same number as the trades-list row", () => {
    for (const t of [trade(), trade({ status: "LOST", pnl: -10_000 })]) {
      expect(settledFeedback(t, "INR").amountMinor).toBe(closedRowDisplay(t).amountMinor);
    }
  });
});

describe("claimAnnouncement", () => {
  const ctx = { accountId: ACCOUNT as string | null };

  it("announces a settlement on the selected account, once", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade(), ctx)).toBe(true);
    expect(claimAnnouncement(seen, trade(), ctx)).toBe(false);
  });

  it("stays silent for another account and never replays it after switching to that account", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade({ accountId: OTHER }), ctx)).toBe(false);
    expect(claimAnnouncement(seen, trade({ accountId: OTHER }), { accountId: OTHER })).toBe(false);
  });

  it("stays silent when no account is selected yet", () => {
    expect(claimAnnouncement(new Set(), trade(), { accountId: null })).toBe(false);
  });

  it("ignores a trade that is not settled", () => {
    expect(claimAnnouncement(new Set(), trade({ status: "OPEN", pnl: 0, exitPrice: null }), ctx)).toBe(false);
  });

  it("does not depend on the device clock: an old-looking or future expiry is still announced", () => {
    expect(claimAnnouncement(new Set(), trade({ expiryTs: 1 }), ctx)).toBe(true);
    expect(claimAnnouncement(new Set(), trade({ expiryTs: 4_000_000_000 }), ctx)).toBe(true);
  });

  it("announces different trades independently", () => {
    const seen = new Set<string>();
    expect(claimAnnouncement(seen, trade({ id: "a" }), ctx)).toBe(true);
    expect(claimAnnouncement(seen, trade({ id: "b" }), ctx)).toBe(true);
  });

  it("forgets the oldest ids once the cap is exceeded, and only those", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) claimAnnouncement(seen, trade({ id: `x${i}` }), ctx);
    expect(seen.size).toBeLessThanOrEqual(200);
    expect(claimAnnouncement(seen, trade({ id: "x299" }), ctx)).toBe(false); // recent: still remembered
    expect(claimAnnouncement(seen, trade({ id: "x0" }), ctx)).toBe(true); // oldest: evicted, so it counts as new
  });
});

describe("newlySettled", () => {
  it("returns the trade only when lastSettled changed to a different one", () => {
    const a = trade({ id: "a" });
    const b = trade({ id: "b" });
    expect(newlySettled(null, a)).toBe(a);
    expect(newlySettled(a, b)).toBe(b);
    expect(newlySettled(a, a)).toBeNull();
    expect(newlySettled(a, null)).toBeNull();
  });

  it("yields two announcements when two settlements land back to back, before any render", () => {
    const seen = new Set<string>();
    const a = trade({ id: "a" });
    const b = trade({ id: "b" });
    const announced: string[] = [];
    // The store notifies a subscriber once per update, so the handler sees null -> a -> b and not just b.
    let prev: TradeView | null = null;
    for (const next of [a, b]) {
      const fresh = newlySettled(prev, next);
      if (fresh && claimAnnouncement(seen, fresh, { accountId: ACCOUNT })) announced.push(fresh.id);
      prev = next;
    }
    expect(announced).toEqual(["a", "b"]);
  });
});
