import { describe, expect, it } from "vitest";
import { initialTradeState } from "@asm/client-core";
import type { Bootstrap, TradeView } from "@asm/contracts";
import { mergeBootstrap, recoveredSettlements, recoveredAccountsWithStaleBalance, withFreshTrades } from "./bootstrap-merge";

const trade = (over: Partial<TradeView> = {}): TradeView => ({
  id: "t1",
  accountId: "a1",
  symbol: "EURUSD",
  direction: "UP",
  stake: 1000,
  payoutPct: 85,
  entryPrice: 1,
  entryTs: 100,
  expiryTs: 160,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
  ...over,
});

const boot = (balances: { real: number; bonus: number }, trades: unknown[] = [trade()]) =>
  ({
    accounts: [{ id: "a1", type: "DEMO", currency: "USD", realBalance: balances.real, bonusBalance: balances.bonus }],
    recentTrades: trades,
  }) as unknown as Bootstrap;

describe("mergeBootstrap", () => {
  it("fills an empty store from the bootstrap, skipping malformed trades", () => {
    const out = mergeBootstrap(initialTradeState([], {}), {}, boot({ real: 5, bonus: 1 }, [trade(), { junk: 1 }]), 1_000);
    expect(out.tradesByAccount["a1"]).toEqual([trade()]);
    expect(out.balances).toEqual({ a1: { realBalance: 5, bonusBalance: 1 } });
  });

  it("never lets a fetched OPEN trade undo a settlement the socket already delivered", () => {
    const settled = trade({ status: "WON", pnl: 85, exitPrice: 2 });
    const state = initialTradeState([settled], {});
    const out = mergeBootstrap(state, {}, boot({ real: 0, bonus: 0 }, [trade()]), 1_000);
    expect(out.tradesByAccount["a1"]?.map((t) => t.status)).toEqual(["WON"]);
  });

  it("adds trades settled while the app was in the background", () => {
    const state = initialTradeState([trade()], {});
    const out = mergeBootstrap(state, {}, boot({ real: 0, bonus: 0 }, [trade({ status: "LOST", pnl: -1000 })]), 1_000);
    expect(out.tradesByAccount["a1"]?.[0]?.status).toBe("LOST");
  });

  it("takes bootstrap balances when the request started after the last socket balance update", () => {
    const state = initialTradeState([], { a1: { realBalance: 1, bonusBalance: 1 } });
    const out = mergeBootstrap(state, { a1: 500 }, boot({ real: 900, bonus: 0 }), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 900, bonusBalance: 0 });
  });

  it("keeps a socket balance that is newer than the bootstrap request", () => {
    const state = initialTradeState([], { a1: { realBalance: 1, bonusBalance: 1 } });
    const out = mergeBootstrap(state, { a1: 700 }, boot({ real: 900, bonus: 0 }), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 1, bonusBalance: 1 });
  });

  it("fills an account the store has no balance for even when other accounts are fresher", () => {
    const state = initialTradeState([], {});
    const out = mergeBootstrap(state, { a1: 700 }, boot({ real: 9, bonus: 9 }), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 9, bonusBalance: 9 });
  });
});

describe("mergeBootstrap: recovered settlements", () => {
  const lost = () => trade({ status: "LOST", pnl: -1000, exitPrice: 2 });

  it("never rolls back a balance stamped after the request started, even when the response settles a trade the store held open", () => {
    // t1's push was lost; a later balance (a post-reconnect push for t2, or an HTTP open result while the socket
    // was down) is stamped 700 > 600 and already includes t1. The older response must not replace it.
    const state = initialTradeState([trade()], { a1: { realBalance: 1, bonusBalance: 1 } });
    const out = mergeBootstrap(state, { a1: 700 }, boot({ real: 900, bonus: 0 }, [lost()]), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 1, bonusBalance: 1 });
    expect(out.tradesByAccount["a1"]?.[0]?.status).toBe("LOST");
  });

  it("applies the bootstrap balance for a recovered settlement when the request started after the stored balance", () => {
    const state = initialTradeState([trade()], { a1: { realBalance: 1, bonusBalance: 1 } });
    const out = mergeBootstrap(state, { a1: 500 }, boot({ real: 900, bonus: 0 }, [lost()]), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 900, bonusBalance: 0 });
  });

  it("still keeps a newer socket balance when the bootstrap settles nothing new", () => {
    const state = initialTradeState([lost()], { a1: { realBalance: 1, bonusBalance: 1 } });
    const out = mergeBootstrap(state, { a1: 700 }, boot({ real: 900, bonus: 0 }, [lost()]), 600);
    expect(out.balances["a1"]).toEqual({ realBalance: 1, bonusBalance: 1 });
  });

  it("recoveredAccountsWithStaleBalance names accounts whose recovered settlement kept a newer stored balance", () => {
    const state = initialTradeState([trade()], { a1: { realBalance: 1, bonusBalance: 1 } });
    const b = boot({ real: 900, bonus: 0 }, [lost()]);
    const after = mergeBootstrap(state, { a1: 700 }, b, 600);
    const recovered = recoveredSettlements(state, after);
    expect(recoveredAccountsWithStaleBalance(state, recovered, { a1: 700 }, b, 600)).toEqual(["a1"]);
  });

  it("recoveredAccountsWithStaleBalance is empty when the bootstrap balance was applied, or nothing was recovered", () => {
    const state = initialTradeState([trade()], { a1: { realBalance: 1, bonusBalance: 1 } });
    const b = boot({ real: 900, bonus: 0 }, [lost()]);
    const recovered = recoveredSettlements(state, mergeBootstrap(state, { a1: 500 }, b, 600));
    expect(recoveredAccountsWithStaleBalance(state, recovered, { a1: 500 }, b, 600)).toEqual([]);
    expect(recoveredAccountsWithStaleBalance(state, [], { a1: 700 }, b, 600)).toEqual([]);
  });

  it("recoveredAccountsWithStaleBalance lists an account once however many of its trades were recovered", () => {
    const state = initialTradeState([trade({ id: "x" }), trade({ id: "y" })], { a1: { realBalance: 1, bonusBalance: 1 } });
    const b = boot({ real: 900, bonus: 0 }, [
      { ...lost(), id: "x" },
      { ...lost(), id: "y" },
    ]);
    const recovered = recoveredSettlements(state, mergeBootstrap(state, { a1: 700 }, b, 600));
    expect(recovered).toHaveLength(2);
    expect(recoveredAccountsWithStaleBalance(state, recovered, { a1: 700 }, b, 600)).toEqual(["a1"]);
  });

  it("recoveredSettlements lists only trades that were open in the store and are settled afterwards", () => {
    const before = initialTradeState([trade({ id: "open-now" }), trade({ id: "was-open" }), trade({ id: "done", status: "WON", pnl: 5 })], {});
    const after = initialTradeState(
      [
        trade({ id: "open-now" }),
        trade({ id: "was-open", status: "LOST", pnl: -1000 }),
        trade({ id: "done", status: "WON", pnl: 5 }),
        trade({ id: "never-seen", status: "WON", pnl: 5 }),
      ],
      {},
    );
    expect(recoveredSettlements(before, after).map((t) => t.id)).toEqual(["was-open"]);
  });

  it("recoveredSettlements is empty when nothing changed", () => {
    const s = initialTradeState([trade()], {});
    expect(recoveredSettlements(s, s)).toEqual([]);
  });
});

describe("withFreshTrades (a currency switch converts the stored trades' amounts)", () => {
  const settled = (over: Partial<TradeView> = {}) => trade({ status: "WON", pnl: 850, exitPrice: 2, ...over });

  it("replaces the stored trades with the fetched ones when the same trade now has other units", () => {
    const state = initialTradeState([trade({ stake: 100_000 }), settled({ id: "t0", stake: 100_000, pnl: 85_000, entryTs: 50 })], {});
    const out = withFreshTrades(state, "a1", [trade({ stake: 1_000 }), settled({ id: "t0", stake: 1_000, pnl: 850, entryTs: 50 })]);
    expect(out.tradesByAccount["a1"]?.map((t) => [t.id, t.stake, t.pnl])).toEqual([["t1", 1_000, 0], ["t0", 1_000, 850]]);
  });

  it("drops a stored trade the fetched window no longer holds when units changed, but keeps one opened after the snapshot", () => {
    const state = initialTradeState([trade({ id: "old", stake: 100_000, entryTs: 10 }), trade({ id: "t1", stake: 100_000, entryTs: 100 }), trade({ id: "fresh", stake: 500, entryTs: 900 })], {});
    const out = withFreshTrades(state, "a1", [trade({ id: "t1", stake: 1_000, entryTs: 100 })]);
    expect(out.tradesByAccount["a1"]?.map((t) => [t.id, t.stake])).toEqual([["fresh", 500], ["t1", 1_000]]);
  });

  it("leaves other accounts alone", () => {
    const state = initialTradeState([trade({ stake: 100_000 }), trade({ id: "x", accountId: "a2", stake: 7 })], {});
    const out = withFreshTrades(state, "a1", [trade({ stake: 1_000 })]);
    expect(out.tradesByAccount["a2"]).toEqual([trade({ id: "x", accountId: "a2", stake: 7 })]);
  });

  it("still merges as before when the units agree (a settled version beats an open one)", () => {
    const state = initialTradeState([settled()], {});
    const out = withFreshTrades(state, "a1", [trade()]);
    expect(out.tradesByAccount["a1"]?.map((t) => t.status)).toEqual(["WON"]);
  });

  it("mergeBootstrap uses it too, so the demo list in a refreshed bootstrap shows the new units", () => {
    const state = initialTradeState([trade({ stake: 100_000 })], {});
    const out = mergeBootstrap(state, {}, boot({ real: 0, bonus: 0 }, [trade({ stake: 1_000 })]), 1_000);
    expect(out.tradesByAccount["a1"]?.[0]?.stake).toBe(1_000);
  });
});
