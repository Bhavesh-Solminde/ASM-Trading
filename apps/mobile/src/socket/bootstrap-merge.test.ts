import { describe, expect, it } from "vitest";
import { initialTradeState } from "@asm/client-core";
import type { Bootstrap, TradeView } from "@asm/contracts";
import { mergeBootstrap } from "./bootstrap-merge";

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
