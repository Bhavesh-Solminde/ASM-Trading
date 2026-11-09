import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { allTrades, AWAKE_GRACE_SEC, awakeDeadlineSec, hasOpenTrade } from "./open-trades";

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

describe("awakeDeadlineSec", () => {
  const openAt = (id: string, accountId: string, expiryTs: number): TradeView => ({ ...trade(id, accountId, "OPEN"), expiryTs });

  it("is null when nothing is open", () => {
    expect(awakeDeadlineSec({})).toBeNull();
    expect(awakeDeadlineSec({ a: [trade("1", "a", "WON")] })).toBeNull();
  });
  it("is the expiry plus the grace for one open trade", () => {
    expect(awakeDeadlineSec({ a: [openAt("1", "a", 1_000)] })).toBe(1_000 + AWAKE_GRACE_SEC);
  });
  it("uses the latest expiry across all accounts, ignoring settled trades", () => {
    const byAccount = { a: [openAt("1", "a", 1_000), { ...trade("2", "a", "WON"), expiryTs: 9_000 }], b: [openAt("3", "b", 1_500)] };
    expect(awakeDeadlineSec(byAccount)).toBe(1_500 + AWAKE_GRACE_SEC);
  });
  it("gives an abandoned settlement about two minutes, no more", () => {
    expect(AWAKE_GRACE_SEC).toBe(120);
  });
});
