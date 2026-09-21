import { TIMEFRAME_SEC, type CandleDto, type ServerMessage, type Timeframe } from "@asm/contracts";

export { TIMEFRAME_SEC };
// The ceiling on retained closed candles. Large because scroll-left backfill
// grows the array leftward; a `candle:close` must not trim bars the user
// scrolled back to load. At 1m this is days of history — effectively a memory
// bound, not a normal-session limit.
const MAX_CANDLES = 5000;

export interface ChartState {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Closed candles, oldest first. */
  readonly candles: CandleDto[];
  /** The candle for the current bucket, built from ticks. Never part of `candles`. */
  readonly forming: CandleDto | null;
  readonly lastPrice: number | null;
  readonly payoutPct: number | null;
  /** Stake-weighted up/down split for this symbol, or null until the first tick. */
  readonly sentiment: { upPct: number; downPct: number } | null;
  /** A `candles:loadOlder` request is in flight; suppresses duplicate requests. */
  readonly loadingOlder: boolean;
  /** No more history exists before the earliest loaded candle. */
  readonly reachedStart: boolean;
}

/**
 * Whether the chart should request older candles. False while a request is in
 * flight, once history is exhausted, before any candle exists, or at the
 * retention ceiling.
 */
export function canLoadOlder(state: ChartState): boolean {
  return (
    !state.loadingOlder &&
    !state.reachedStart &&
    state.candles.length > 0 &&
    state.candles.length < MAX_CANDLES
  );
}

export function initialChartState(symbol: string, timeframe: Timeframe): ChartState {
  return {
    symbol,
    timeframe,
    candles: [],
    forming: null,
    lastPrice: null,
    payoutPct: null,
    sentiment: null,
    loadingOlder: false,
    reachedStart: false,
  };
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
      // A fresh history batch resets backfill: any in-flight request is now
      // stale, and whether older history exists is unknown again.
      return { ...state, candles, forming, loadingOlder: false, reachedStart: false };
    }

    case "candles:older": {
      if (message.symbol !== state.symbol || message.timeframe !== state.timeframe) return state;
      const oldestTs = state.candles[0]?.openTs ?? Infinity;
      // Keep only candles strictly older than what we already hold, so an
      // overlapping batch can never duplicate or reorder existing bars.
      const older = message.candles.filter((c) => c.openTs < oldestTs);
      const candles =
        older.length === 0 ? state.candles : [...older, ...state.candles].slice(-MAX_CANDLES);
      return { ...state, candles, loadingOlder: false, reachedStart: message.reachedStart };
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

    case "sentiment":
      return message.symbol === state.symbol
        ? { ...state, sentiment: { upPct: message.upPct, downPct: message.downPct } }
        : state;

    default:
      return state;
  }
}
