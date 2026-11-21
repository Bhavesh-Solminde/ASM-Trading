import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import {
  applyTradeMessage,
  initialTradeState,
  upsertTrade,
  withTrade,
  withFetchedTrades,
  withOpenResult,
  withoutTrade,
  pendingTradeView,
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

describe("withOpenResult", () => {
  // The socket delivered a settlement (10,000) after the open's own balance
  // update (9,980) but before the HTTP response carrying 9,980 arrived.
  const settledFirst = applyTradeMessage(initialTradeState([], {}), {
    type: "balance:update",
    accountId: "acct-demo",
    realBalance: 1_000_000,
    bonusBalance: 0,
  });
  const staleResult = { trade: trade(), balances: { realBalance: 998_000, bonusBalance: 0 } };

  it("never lets the HTTP balance overwrite the socket's while the socket is live", () => {
    const next = withOpenResult(settledFirst, staleResult, true);
    expect(next.balances["acct-demo"]).toEqual({ realBalance: 1_000_000, bonusBalance: 0 });
    expect(next.tradesByAccount["acct-demo"]).toEqual([staleResult.trade]);
  });

  it("falls back to the HTTP balance when the socket is down", () => {
    const next = withOpenResult(settledFirst, staleResult, false);
    expect(next.balances["acct-demo"]).toEqual({ realBalance: 998_000, bonusBalance: 0 });
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

describe("Opening… placeholder", () => {
  const order = { idempotencyKey: "k-1", accountId: "acct-demo", symbol: "BTCUSDT", direction: "UP" as const, stake: 10000, durationSec: 60, payoutPct: 92, entryPrice: 81000 };

  it("shows an open OTC trade at the displayed price, with its countdown starting now", () => {
    const placeholder = pendingTradeView(order, 5000);
    expect(placeholder).toMatchObject({ id: "pending:k-1", status: "OPEN", mode: "OTC_FIXED", pending: true, entryPrice: 81000, entryTs: 5000, expiryTs: 5060 });
    const state = withTrade(initialTradeState([], {}), placeholder);
    expect(state.tradesByAccount["acct-demo"]?.map((t) => t.id)).toEqual(["pending:k-1"]);
  });

  it("is replaced by the engine's trade without disturbing the others", () => {
    const other = trade();
    const confirmed = trade({ id: "real-1", entryTs: 5000 });
    let state = withTrade(initialTradeState([other], {}), pendingTradeView(order, 5000));
    state = withoutTrade(withOpenResult(state, { trade: confirmed, balances: { realBalance: 1, bonusBalance: 0 } }, true), "acct-demo", "pending:k-1");
    expect(state.tradesByAccount["acct-demo"]?.map((t) => t.id)).toEqual(["real-1", other.id]);
  });

  it("leaves state untouched when the placeholder is already gone", () => {
    const state = initialTradeState([trade()], {});
    expect(withoutTrade(state, "acct-demo", "pending:missing")).toBe(state);
    expect(withoutTrade(state, "other-account", "pending:missing")).toBe(state);
  });
});
