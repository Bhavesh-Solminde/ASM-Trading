import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TradeView } from "@asm/contracts";
import { Chart } from "@/chart/Chart";
import type { ChartType } from "@/chart/types";
import type { ResumeSnapshot } from "@/cache/codec";
import { useSocket } from "@/socket/socket-store";
import { chartSource } from "./chart-source";
import { tradeLabel } from "./trade-label";
import { useNow } from "./useNow";

/** One shared empty list: a fresh `[]` per render would defeat the history commit's change check. */
const NO_CANDLES: ResumeSnapshot["candles"] = [];
const loadOlder = () => useSocket.getState().loadOlder();

/**
 * The chart wired to the socket store. It owns the per-tick subscription (and the 1s clock, only while a
 * trade is open: the clock drives the countdown labels), so the Trade screen around it does not re-render
 * with every price update or second.
 *
 * Candles come from `chartSource`: live ones for exactly the current selection, else the stale `snapshot`
 * if it matches the selection (the caller passes null once live data has arrived), else nothing.
 * `tradesSnapshot` supplies cached open trades until bootstrap arrives: they are shown but frozen (countdown
 * pinned to the snapshot time, nothing settled locally); live socket/bootstrap trades replace them.
 */
export function TradeChart({
  symbol,
  timeframe,
  type,
  precision,
  accountId,
  snapshot,
  tradesSnapshot,
  topInset,
  hideReadout,
}: {
  symbol: string;
  timeframe: ResumeSnapshot["timeframe"];
  type: ChartType;
  precision: number;
  accountId: string | null;
  snapshot: ResumeSnapshot | null;
  tradesSnapshot: ResumeSnapshot | null;
  /** Top of the chart readout, below the overlay row (forwarded to `Chart`). */
  topInset?: number;
  /** Hide the readout while the chart-tools panel is open (forwarded to `Chart`). */
  hideReadout?: boolean;
}) {
  const { t } = useTranslation();
  const chart = useSocket((s) => s.chart);
  const liveTrades = useSocket((s) => (accountId ? s.trades.tradesByAccount[accountId] : undefined));
  const source = chartSource({ symbol, timeframe, chart, snapshot });

  const staleTrades = tradesSnapshot !== null && tradesSnapshot.accountId === accountId ? tradesSnapshot : null;
  const openTrades = useMemo<TradeView[]>(() => {
    const from = staleTrades ? staleTrades.openTrades : (liveTrades ?? []);
    return from.filter((t) => t.status === "OPEN" && t.symbol === symbol);
  }, [staleTrades, liveTrades, symbol]);

  // Tick only for live trades: frozen cached ones, and an empty book, need no countdown.
  const nowMs = useNow(openTrades.length > 0 && !staleTrades ? 1000 : null);
  const nowSec = staleTrades ? Math.floor(staleTrades.savedAt / 1000) : Math.floor(nowMs / 1000);

  // The trade line says "Settling…" after the expiry, like the position strip (a stale snapshot reads the same).
  const settling = t("trade.settling");
  const labelFor = useCallback((tr: TradeView, now: number) => tradeLabel(tr.expiryTs, now, settling), [settling]);

  const live = source === "live";
  return (
    <Chart
      key={`${symbol}:${timeframe}`}
      type={type}
      candles={live ? chart.candles : source === "snapshot" && snapshot ? snapshot.candles : NO_CANDLES}
      forming={live ? chart.forming : null}
      lastPrice={live ? chart.lastPrice : null}
      precision={precision}
      openTrades={openTrades}
      nowSec={nowSec}
      labelFor={labelFor}
      topInset={topInset}
      hideReadout={hideReadout}
      onNearLeftEdge={loadOlder}
    />
  );
}
