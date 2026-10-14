import type { ChartState, TradeState } from "@asm/client-core";
import type { Timeframe } from "@asm/contracts";
import type { ResumeSnapshot } from "./codec";

/**
 * The resume snapshot for the current screen state, or null when there is nothing trustworthy to save:
 * signed out (sign-out must never be followed by a write), no user/account yet, or the chart not yet holding
 * candles for the chosen market and timeframe.
 */
export function buildResumeSnapshot(i: {
  userId: string | null;
  accountId: string | null;
  symbol: string | null;
  timeframe: Timeframe;
  precision: number;
  chart: ChartState;
  trades: TradeState;
  signedIn: boolean;
  now: number;
}): ResumeSnapshot | null {
  if (!i.signedIn || !i.userId || !i.accountId || !i.symbol) return null;
  if (i.chart.symbol !== i.symbol || i.chart.timeframe !== i.timeframe || i.chart.candles.length === 0) return null;
  return {
    v: 1,
    savedAt: i.now,
    userId: i.userId,
    symbol: i.symbol,
    timeframe: i.timeframe,
    candles: i.chart.candles,
    balances: { ...i.trades.balances },
    openTrades: (i.trades.tradesByAccount[i.accountId] ?? []).filter((t) => t.status === "OPEN"),
    accountId: i.accountId,
    precision: i.precision,
  };
}
