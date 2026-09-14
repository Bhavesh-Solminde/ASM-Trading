import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  applyTradeMessage,
  initialTradeState,
  upsertTrade,
  withFetchedTrades,
} from "./trade-state";

let seq = 0;
function trade(overrides: Partial<TradeView> = {}): TradeView {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: "acct-demo",
    symbol: "AUDNZD_OTC",
    direction: "UP",
    stake: 100,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: 1_000 + seq,
    expiryTs: 1_060 + seq,
    exitPrice: null,
    status: "OPEN",
    pnl: 0,
    ...overrides,
  };
}

describe("upsertTrade", () => {
  it("replaces an open trade with its settled version", () => {
    const open = trade();
    const settled = { ...open, status: "WON" as const, exitPrice: 1.176, pnl: 100 };
    const list = upsertTrade(upsertTrade([], open), settled);
    expect(list).toEqual([settled]);
  });

  it("never lets a late OPEN overwrite a settled trade", () => {
    const open = trade();
    const settled = { ...open, status: "LOST" as const, exitPrice: 1.174, pnl: -100 };
    expect(upsertTrade([settled], open)).toEqual([settled]);
  });

  it("keeps newest first and caps each account at fifty", () => {
    let list: TradeView[] = [];
    for (let i = 0; i < 60; i++) list = upsertTrade(list, trade());
    expect(list).toHaveLength(50);
    expect(list[0]!.entryTs).toBeGreaterThan(list[49]!.entryTs);
  });
});

describe("applyTradeMessage", () => {
  it("routes trades to their own account", () => {
    const state = [
      trade({ accountId: "acct-live" }),
      trade({ accountId: "acct-demo" }),
    ].reduce(
      (s, t) => applyTradeMessage(s, { type: "trade:opened", trade: t }),
      initialTradeState([], {}),
    );
    expect(state.tradesByAccount["acct-live"]).toHaveLength(1);
    expect(state.tradesByAccount["acct-demo"]).toHaveLength(1);
  });

  it("records balances per account", () => {
    const state = applyTradeMessage(initialTradeState([], {}), {
      type: "balance:update",
      accountId: "acct-demo",
      realBalance: 990_000,
      bonusBalance: 0,
    });
    expect(state.balances["acct-demo"]).toEqual({ realBalance: 990_000, bonusBalance: 0 });
  });

  it("ignores unrelated messages", () => {
    const before = initialTradeState([], {});
    expect(applyTradeMessage(before, { type: "ready", serverTs: 0 })).toBe(before);
  });
});

describe("withFetchedTrades", () => {
  it("keeps a settlement that arrived over the socket while the fetch was in flight", () => {
    const open = trade();
    const settled = { ...open, status: "WON" as const, exitPrice: 1.176, pnl: 100 };
    const state = applyTradeMessage(initialTradeState([], {}), { type: "trade:settled", trade: settled });
    const next = withFetchedTrades(state, "acct-demo", [open]);
    expect(next.tradesByAccount["acct-demo"]).toEqual([settled]);
  });

  it("adds fetched history the socket never delivered", () => {
    const old = trade({ status: "LOST", exitPrice: 1.1, pnl: -100 });
    const next = withFetchedTrades(initialTradeState([], {}), "acct-demo", [old]);
    expect(next.tradesByAccount["acct-demo"]).toEqual([old]);
  });
});
