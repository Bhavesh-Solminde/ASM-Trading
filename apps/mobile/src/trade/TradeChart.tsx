import { useMemo } from "react";
import type { TradeView } from "@asm/contracts";
import { Chart } from "@/chart/Chart";
import type { ChartType } from "@/chart/types";
import type { ResumeSnapshot } from "@/cache/codec";
import { useSocket } from "@/socket/socket-store";
import { useNow } from "./useNow";

const loadOlder = () => useSocket.getState().loadOlder();

/**
 * The chart wired to the socket store. It owns the per-tick subscription and the 1s clock, so the Trade
 * screen around it does not re-render with every price update or second.
 *
 * While no live candles exist yet it paints `cached` (the resume snapshot, stale by definition). Cached
 * open trades are shown but frozen: their countdown is pinned to the time the snapshot was taken, and
 * nothing is settled locally; live socket/bootstrap trades replace them as soon as bootstrap arrives.
 */
export function TradeChart({
  symbol,
  timeframe,
  type,
  precision,
  accountId,
  cached,
  cachedTradesAreCurrent,
}: {
  symbol: string;
  timeframe: ResumeSnapshot["timeframe"];
  type: ChartType;
  precision: number;
  accountId: string | null;
  cached: ResumeSnapshot | null;
  /** True once bootstrap has seeded the live trades, so cached ones must no longer be shown. */
  cachedTradesAreCurrent: boolean;
}) {
  const chart = useSocket((s) => s.chart);
  const liveTrades = useSocket((s) => (accountId ? s.trades.tradesByAccount[accountId] : undefined));
  const nowMs = useNow();

  const useCache = chart.candles.length === 0 && cached !== null && cached.symbol === symbol && cached.timeframe === timeframe;
  const showStaleTrades = !cachedTradesAreCurrent && cached !== null && cached.accountId === accountId;

  const openTrades = useMemo<TradeView[]>(() => {
    const source = showStaleTrades ? cached.openTrades : (liveTrades ?? []);
    return source.filter((t) => t.status === "OPEN" && t.symbol === symbol);
  }, [showStaleTrades, cached, liveTrades, symbol]);

  const nowSec = showStaleTrades ? Math.floor(cached.savedAt / 1000) : Math.floor(nowMs / 1000);

  return (
    <Chart
      key={`${symbol}:${timeframe}`}
      type={type}
      candles={useCache ? cached.candles : chart.candles}
      forming={useCache ? null : chart.forming}
      lastPrice={useCache ? null : chart.lastPrice}
      precision={precision}
      openTrades={openTrades}
      nowSec={nowSec}
      onNearLeftEdge={loadOlder}
    />
  );
}
