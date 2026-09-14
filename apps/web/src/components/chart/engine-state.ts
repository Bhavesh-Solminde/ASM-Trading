import type { CandleDto, ServerMessage, Timeframe } from "@asm/contracts";

export const TIMEFRAME_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900 };
const MAX_CANDLES = 500;

export interface ChartState {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Closed candles, oldest first. */
  readonly candles: CandleDto[];
  /** The candle for the current bucket, built from ticks. Never part of `candles`. */
  readonly forming: CandleDto | null;
  readonly lastPrice: number | null;
  readonly payoutPct: number | null;
}

export function initialChartState(symbol: string, timeframe: Timeframe): ChartState {
  return { symbol, timeframe, candles: [], forming: null, lastPrice: null, payoutPct: null };
}

/**
 * Folds one server message into chart state. Pure, so the candle logic is
 * unit-tested rather than eyeballed on a live chart.
 *
 * Messages for another symbol are ignored — after an asset switch, a tick
 * already in flight for the old asset must not paint onto the new chart.
 */
export function applyChartMessage(state: ChartState, message: ServerMessage): ChartState {
  switch (message.type) {
    case "candles:history": {
      if (message.symbol !== state.symbol || message.timeframe !== state.timeframe) return state;
      const candles = message.candles.slice(-MAX_CANDLES);
      const last = candles.at(-1);
      const forming = state.forming && last && state.forming.openTs <= last.openTs ? null : state.forming;
      return { ...state, candles, forming };
    }

    case "candle:close": {
      if (message.symbol !== state.symbol || message.timeframe !== state.timeframe) return state;
      const candles = [
        ...state.candles.filter((c) => c.openTs !== message.candle.openTs),
        message.candle,
      ]
        .sort((a, b) => a.openTs - b.openTs)
        .slice(-MAX_CANDLES);
      const forming =
        state.forming && state.forming.openTs <= message.candle.openTs ? null : state.forming;
      return { ...state, candles, forming };
    }

    case "tick": {
      if (message.symbol !== state.symbol) return state;
      const width = TIMEFRAME_SEC[state.timeframe];
      const openTs = Math.floor(message.ts / width) * width;
      const last = state.candles.at(-1);

      // The bucket has already closed; drawing it again would reopen history.
      if (last && openTs <= last.openTs) return { ...state, lastPrice: message.price };

      // Older than the candle already forming: replacing it would hand the
      // chart a bar older than its newest, which lightweight-charts rejects.
      if (state.forming && openTs < state.forming.openTs) return state;

      const forming =
        state.forming && state.forming.openTs === openTs
          ? {
              ...state.forming,
              h: Math.max(state.forming.h, message.price),
              l: Math.min(state.forming.l, message.price),
              c: message.price,
            }
          : { openTs, o: message.price, h: message.price, l: message.price, c: message.price };

      return { ...state, forming, lastPrice: message.price };
    }

    case "payout:update":
      return message.symbol === state.symbol ? { ...state, payoutPct: message.payoutPct } : state;

    default:
      return state;
  }
}
