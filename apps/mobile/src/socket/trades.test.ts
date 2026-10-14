import { describe, expect, it } from "vitest";
import { parseTrades } from "./trades";

const trade = {
  id: "t1",
  accountId: "a1",
  symbol: "EURUSD",
  direction: "UP",
  stake: 10000,
  payoutPct: 85,
  entryPrice: 1.1,
  entryTs: 100,
  expiryTs: 160,
  exitPrice: null,
  status: "OPEN",
  pnl: 0,
};

describe("parseTrades", () => {
  it("keeps well-formed trades", () => {
    expect(parseTrades([trade])).toEqual([trade]);
  });
  it("drops malformed rows instead of throwing", () => {
    expect(parseTrades([trade, { id: "bad" }, { ...trade, status: "WEIRD" }, null, "x"])).toEqual([trade]);
  });
});
