import { describe, expect, it } from "vitest";
import { OpenTradeSchema } from "@asm/contracts";
import { OpenTradeResultSchema, buildOpenTradeBody } from "./trade-request";

const ACCOUNT = "0b7d7e6e-5f0e-4c43-9a4f-2d3c1b0a9e11";

describe("buildOpenTradeBody", () => {
  it("builds exactly the contract's keys", () => {
    const body = buildOpenTradeBody({ accountId: ACCOUNT, symbol: "EURUSD", direction: "UP", stakeMinor: 10_000, durationSec: 30 });
    expect(Object.keys(body).sort()).toEqual(["accountId", "direction", "durationSec", "stake", "symbol"]);
    expect(OpenTradeSchema.parse(body)).toEqual(body);
  });
  it("throws for a duration the contract does not offer", () => {
    expect(() => buildOpenTradeBody({ accountId: ACCOUNT, symbol: "EURUSD", direction: "UP", stakeMinor: 10_000, durationSec: 31 })).toThrow();
  });
  it("throws for a non-integer stake", () => {
    expect(() => buildOpenTradeBody({ accountId: ACCOUNT, symbol: "EURUSD", direction: "DOWN", stakeMinor: 100.5, durationSec: 30 })).toThrow();
  });
});

describe("OpenTradeResultSchema", () => {
  const trade = {
    id: "t1", accountId: ACCOUNT, symbol: "EURUSD", direction: "UP", stake: 10000, payoutPct: 85,
    entryPrice: 1.1, entryTs: 100, expiryTs: 160, exitPrice: null, status: "OPEN", pnl: 0,
  };
  it("accepts a well-formed response", () => {
    const r = { trade, balances: { realBalance: 5, bonusBalance: 6 } };
    expect(OpenTradeResultSchema.parse(r)).toEqual(r);
  });
  it("rejects a response without a valid trade", () => {
    expect(OpenTradeResultSchema.safeParse({ trade: { id: "x" }, balances: { realBalance: 1, bonusBalance: 1 } }).success).toBe(false);
  });
});
