import { describe, expect, it } from "vitest";
import type { ResumeSnapshot } from "@/cache/codec";
import { accountOfType, bootstrapTradesAccountId, canUseLive, resolveAccount, staleBalance, type AppAccount } from "./accounts";

const demo: AppAccount = { id: "d", type: "DEMO", currency: "USD", realBalance: 0, bonusBalance: 0 };
const live: AppAccount = { id: "l", type: "LIVE", currency: "USD", realBalance: 0, bonusBalance: 0 };

describe("account selection", () => {
  it("restores the saved account", () => {
    expect(resolveAccount([demo, live], "l", true)?.id).toBe("l");
    expect(resolveAccount([demo, live], "d", true)?.id).toBe("d");
  });
  it("falls back to demo when nothing is saved or the saved account is gone", () => {
    expect(resolveAccount([live, demo], null, true)?.id).toBe("d");
    expect(resolveAccount([demo, live], "gone", true)?.id).toBe("d");
  });
  it("never lands on the live account without live access", () => {
    expect(resolveAccount([demo, live], "l", false)?.id).toBe("d");
  });
  it("uses whatever exists when there is no demo account", () => {
    expect(resolveAccount([live], null, true)?.id).toBe("l");
    expect(resolveAccount([], null, true)).toBeUndefined();
  });
  it("allows live only with access and a live account", () => {
    expect(canUseLive([demo, live], true)).toBe(true);
    expect(canUseLive([demo, live], false)).toBe(false);
    expect(canUseLive([demo], true)).toBe(false);
  });
  it("finds an account by type", () => {
    expect(accountOfType([demo, live], "LIVE")?.id).toBe("l");
    expect(accountOfType([demo], "LIVE")).toBeUndefined();
  });
});

describe("staleBalance (the cached balance shown until bootstrap arrives)", () => {
  const snap = (over: Partial<ResumeSnapshot> = {}): ResumeSnapshot => ({
    v: 1,
    savedAt: 1,
    userId: "u",
    symbol: "EURUSD",
    timeframe: "1m",
    candles: [],
    balances: { d: { realBalance: 900, bonusBalance: 100 } },
    openTrades: [],
    accountId: "d",
    account: { type: "DEMO", currency: "INR" },
    ...over,
  });

  it("is the saved account's real + bonus balance with its type and currency", () => {
    expect(staleBalance(snap())).toEqual({ totalMinor: 1_000, type: "DEMO", currency: "INR", live: false });
  });

  it("prefers a balance the store already holds for that account (socket or HTTP) over the cached one, and says it is live", () => {
    expect(staleBalance(snap(), { realBalance: 50, bonusBalance: 5 })).toEqual({ totalMinor: 55, type: "DEMO", currency: "INR", live: true });
  });

  it("still returns the cached balance when the store has none", () => {
    expect(staleBalance(snap(), undefined)).toMatchObject({ totalMinor: 1_000, live: false });
  });

  it("is null without a snapshot, without the account record (older snapshot) or without that account's balance", () => {
    expect(staleBalance(null)).toBeNull();
    expect(staleBalance(snap({ account: undefined }))).toBeNull();
    expect(staleBalance(snap({ balances: {} }))).toBeNull();
  });
});

describe("bootstrapTradesAccountId", () => {
  it("is the demo account (what the server puts in recentTrades), whatever the order", () => {
    expect(bootstrapTradesAccountId([live, demo])).toBe("d");
    expect(bootstrapTradesAccountId([demo, live])).toBe("d");
  });
  it("is the first account when there is no demo, and undefined for none", () => {
    expect(bootstrapTradesAccountId([live])).toBe("l");
    expect(bootstrapTradesAccountId([])).toBeUndefined();
  });
});
