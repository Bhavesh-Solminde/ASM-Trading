import { describe, expect, it } from "vitest";
import { initialChartState, initialTradeState } from "@asm/client-core";
import type { CandleDto, TradeView } from "@asm/contracts";
import { buildResumeSnapshot } from "./snapshot";

const candle = (openTs: number): CandleDto => ({ openTs, o: 1, h: 2, l: 0.5, c: 1.5 });
const trade = (id: string, status: TradeView["status"], accountId = "acc"): TradeView => ({
  id,
  accountId,
  symbol: "EURUSD",
  direction: "UP",
  stake: 1000,
  payoutPct: 85,
  entryPrice: 1,
  entryTs: 100,
  expiryTs: 160,
  exitPrice: null,
  status,
  pnl: 0,
});

function inputs(over: Partial<Parameters<typeof buildResumeSnapshot>[0]> = {}) {
  return {
    userId: "u1",
    accountId: "acc",
    symbol: "EURUSD",
    timeframe: "1m" as const,
    chart: { ...initialChartState("EURUSD", "1m"), candles: [candle(60), candle(120)] },
    trades: initialTradeState([trade("o", "OPEN"), trade("w", "WON"), trade("x", "OPEN", "other")], {
      acc: { realBalance: 5, bonusBalance: 1 },
    }),
    precision: 5,
    account: { type: "DEMO" as const, currency: "INR" },
    signedIn: true,
    now: 1_000,
    ...over,
  };
}

describe("buildResumeSnapshot", () => {
  it("captures the live chart, balances and only this account's open trades", () => {
    const s = buildResumeSnapshot(inputs());
    expect(s).toMatchObject({ v: 1, savedAt: 1_000, userId: "u1", symbol: "EURUSD", timeframe: "1m", accountId: "acc" });
    expect(s?.candles).toHaveLength(2);
    expect(s?.openTrades.map((t) => t.id)).toEqual(["o"]);
    expect(s?.balances).toEqual({ acc: { realBalance: 5, bonusBalance: 1 } });
  });

  it("records the market's precision for the pre-bootstrap axis", () => {
    expect(buildResumeSnapshot(inputs())?.precision).toBe(5);
  });

  it("records the account's type and currency for the pre-bootstrap balance", () => {
    expect(buildResumeSnapshot(inputs())?.account).toEqual({ type: "DEMO", currency: "INR" });
  });

  it("saves nothing when signed out", () => {
    expect(buildResumeSnapshot(inputs({ signedIn: false }))).toBeNull();
  });

  it("saves nothing before the chart has candles for the chosen market and timeframe", () => {
    expect(buildResumeSnapshot(inputs({ chart: initialChartState("EURUSD", "1m") }))).toBeNull();
    expect(buildResumeSnapshot(inputs({ symbol: "BTCUSD" }))).toBeNull();
    expect(buildResumeSnapshot(inputs({ timeframe: "5m" }))).toBeNull();
  });

  it("saves nothing without a user or account", () => {
    expect(buildResumeSnapshot(inputs({ userId: null }))).toBeNull();
    expect(buildResumeSnapshot(inputs({ accountId: null }))).toBeNull();
  });
});
