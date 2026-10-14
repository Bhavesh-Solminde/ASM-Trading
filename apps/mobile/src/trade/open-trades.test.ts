import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { allTrades, hasOpenTrade } from "./open-trades";

const trade = (id: string, accountId: string, status: TradeView["status"]): TradeView => ({
  id,
  accountId,
  symbol: "EURUSD",
  direction: "UP",
  stake: 10_000,
  payoutPct: 80,
  entryPrice: 1,
  entryTs: 0,
  expiryTs: 30,
  exitPrice: status === "OPEN" ? null : 1.1,
  status,
  pnl: 0,
});

describe("hasOpenTrade", () => {
  it("is false with no trades at all", () => {
    expect(hasOpenTrade({})).toBe(false);
  });
  it("is false when everything is settled", () => {
    expect(hasOpenTrade({ a: [trade("1", "a", "WON")], b: [trade("2", "b", "LOST")] })).toBe(false);
  });
  it("counts an open trade on ANY account, not just the selected one", () => {
    expect(hasOpenTrade({ a: [trade("1", "a", "WON")], b: [trade("2", "b", "OPEN")] })).toBe(true);
  });
});

describe("allTrades", () => {
  it("flattens every account's list", () => {
    expect(allTrades({ a: [trade("1", "a", "OPEN")], b: [trade("2", "b", "WON"), trade("3", "b", "OPEN")] }).map((t) => t.id)).toEqual(["1", "2", "3"]);
  });
});
