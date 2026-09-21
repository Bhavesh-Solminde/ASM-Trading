import { describe, expect, it } from "vitest";
import type { CandleDto, ServerMessage } from "@asm/contracts";
import { applyChartMessage, canLoadOlder, initialChartState } from "./engine-state";

const MAX_CANDLES = 5000;

const MIN = 1_757_534_280; // a minute boundary

function candle(openTs: number, c = 1.1): CandleDto {
  return { openTs, o: 1.1, h: 1.2, l: 1.0, c };
}

function fold(messages: ServerMessage[]) {
  return messages.reduce(applyChartMessage, initialChartState("AUDNZD_OTC", "1m"));
}

describe("applyChartMessage", () => {
  it("replaces candles with history and caps them at the retention ceiling", () => {
    const n = MAX_CANDLES + 100;
    const candles = Array.from({ length: n }, (_, i) => candle(MIN + i * 60));
    const state = fold([{ type: "candles:history", symbol: "AUDNZD_OTC", timeframe: "1m", candles }]);
    expect(state.candles).toHaveLength(MAX_CANDLES);
    // The newest bars are kept; the oldest overflow is dropped.
    expect(state.candles.at(-1)?.openTs).toBe(MIN + (n - 1) * 60);
    expect(state.candles[0]?.openTs).toBe(MIN + 100 * 60);
  });

  it("ignores every message for a different symbol", () => {
    const state = fold([
      { type: "tick", symbol: "EURUSD_OTC", price: 9, ts: MIN },
      { type: "payout:update", symbol: "EURUSD_OTC", payoutPct: 10 },
      { type: "candle:close", symbol: "EURUSD_OTC", timeframe: "1m", candle: candle(MIN) },
    ]);
    expect(state.forming).toBeNull();
    expect(state.payoutPct).toBeNull();
    expect(state.candles).toEqual([]);
  });

  it("opens a forming candle in the tick's own minute bucket", () => {
    const state = fold([{ type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 17 }]);
    expect(state.forming).toEqual({ openTs: MIN, o: 1.17, h: 1.17, l: 1.17, c: 1.17 });
    expect(state.lastPrice).toBe(1.17);
  });

  it("extends high, low and close for ticks in the same bucket", () => {
    const state = fold([
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 1 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.19, ts: MIN + 2 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.16, ts: MIN + 3 },
    ]);
    expect(state.forming).toEqual({ openTs: MIN, o: 1.17, h: 1.19, l: 1.16, c: 1.16 });
  });

  it("starts a fresh forming candle when a tick crosses into the next bucket", () => {
    const state = fold([
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 59 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.18, ts: MIN + 60 },
    ]);
    expect(state.forming?.openTs).toBe(MIN + 60);
    expect(state.forming?.o).toBe(1.18);
  });

  it("appends a closed candle, de-duplicates by openTs, and clears the forming candle it closed", () => {
    const state = fold([
      { type: "candles:history", symbol: "AUDNZD_OTC", timeframe: "1m", candles: [candle(MIN - 60)] },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.17, ts: MIN + 5 },
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN, 1.1) },
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN, 1.15) },
    ]);
    expect(state.candles.map((c) => c.openTs)).toEqual([MIN - 60, MIN]);
    expect(state.candles.at(-1)?.c).toBe(1.15);
    expect(state.forming).toBeNull();
  });

  it("updates only lastPrice for a late tick in an already-closed bucket", () => {
    const state = fold([
      { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN) },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.3, ts: MIN + 30 },
    ]);
    expect(state.forming).toBeNull();
    expect(state.lastPrice).toBe(1.3);
  });

  it("ignores a tick older than the forming candle's bucket", () => {
    const state = fold([
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.18, ts: MIN + 60 },
      { type: "tick", symbol: "AUDNZD_OTC", price: 1.1, ts: MIN + 30 },
    ]);
    expect(state.forming).toEqual({ openTs: MIN + 60, o: 1.18, h: 1.18, l: 1.18, c: 1.18 });
    expect(state.lastPrice).toBe(1.18);
  });

  it("records the payout for its own symbol", () => {
    expect(fold([{ type: "payout:update", symbol: "AUDNZD_OTC", payoutPct: 92 }]).payoutPct).toBe(92);
  });

  describe("scroll-left history", () => {
    const history = (candles: CandleDto[]): ServerMessage => ({
      type: "candles:history",
      symbol: "AUDNZD_OTC",
      timeframe: "1m",
      candles,
    });

    it("prepends older candles ahead of the earliest held bar", () => {
      const state = fold([
        history([candle(MIN), candle(MIN + 60)]),
        {
          type: "candles:older",
          symbol: "AUDNZD_OTC",
          timeframe: "1m",
          candles: [candle(MIN - 120), candle(MIN - 60)],
          reachedStart: false,
        },
      ]);
      expect(state.candles.map((c) => c.openTs)).toEqual([MIN - 120, MIN - 60, MIN, MIN + 60]);
      expect(state.loadingOlder).toBe(false);
      expect(state.reachedStart).toBe(false);
    });

    it("drops overlapping older candles so bars never duplicate or reorder", () => {
      const state = fold([
        history([candle(MIN), candle(MIN + 60)]),
        {
          type: "candles:older",
          symbol: "AUDNZD_OTC",
          timeframe: "1m",
          // MIN and MIN+60 overlap what we hold; only MIN-60 is genuinely older.
          candles: [candle(MIN - 60), candle(MIN), candle(MIN + 60)],
          reachedStart: true,
        },
      ]);
      expect(state.candles.map((c) => c.openTs)).toEqual([MIN - 60, MIN, MIN + 60]);
      expect(state.reachedStart).toBe(true);
    });

    it("keeps backfilled history when a later candle closes", () => {
      const state = fold([
        history([candle(MIN)]),
        {
          type: "candles:older",
          symbol: "AUDNZD_OTC",
          timeframe: "1m",
          candles: [candle(MIN - 120), candle(MIN - 60)],
          reachedStart: true,
        },
        { type: "candle:close", symbol: "AUDNZD_OTC", timeframe: "1m", candle: candle(MIN + 60) },
      ]);
      expect(state.candles.map((c) => c.openTs)).toEqual([MIN - 120, MIN - 60, MIN, MIN + 60]);
    });

    it("resets backfill state on a fresh history batch", () => {
      const older: ServerMessage = {
        type: "candles:older",
        symbol: "AUDNZD_OTC",
        timeframe: "1m",
        candles: [],
        reachedStart: true,
      };
      const state = fold([history([candle(MIN)]), older, history([candle(MIN + 120)])]);
      expect(state.reachedStart).toBe(false);
      expect(state.loadingOlder).toBe(false);
      expect(state.candles.map((c) => c.openTs)).toEqual([MIN + 120]);
    });

    it("gates loading on in-flight, exhausted and empty states", () => {
      const base = fold([history([candle(MIN)])]);
      expect(canLoadOlder(base)).toBe(true);
      expect(canLoadOlder(initialChartState("AUDNZD_OTC", "1m"))).toBe(false); // no candles yet
      expect(canLoadOlder({ ...base, loadingOlder: true })).toBe(false);
      expect(canLoadOlder({ ...base, reachedStart: true })).toBe(false);
    });
  });
});
