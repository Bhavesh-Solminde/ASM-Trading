import { describe, expect, it } from "vitest";
import { initialChartState } from "@asm/client-core";
import type { CandleDto } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";
import { chartSource } from "./chart-source";

const candle: CandleDto = { openTs: 60, o: 1, h: 2, l: 0.5, c: 1.5 };
const snapshot = (over: Partial<ResumeSnapshot> = {}): ResumeSnapshot => ({
  v: 1,
  savedAt: 1,
  userId: "u",
  symbol: "EURUSD",
  timeframe: "1m",
  candles: [candle],
  balances: {},
  openTrades: [],
  accountId: "a",
  ...over,
});
const live = (symbol: string, timeframe: "1m" | "5m", candles: CandleDto[] = [candle]) => ({
  ...initialChartState(symbol, timeframe),
  candles,
});

describe("chartSource", () => {
  it("is live when the chart holds candles for exactly the selection", () => {
    expect(chartSource({ symbol: "EURUSD", timeframe: "1m", chart: live("EURUSD", "1m"), snapshot: snapshot() })).toBe("live");
  });

  it("falls back to the snapshot only while the chart has nothing for the selection and the snapshot matches it", () => {
    const empty = initialChartState("EURUSD", "1m");
    expect(chartSource({ symbol: "EURUSD", timeframe: "1m", chart: empty, snapshot: snapshot() })).toBe("snapshot");
    // Chart not subscribed yet (initial store state).
    expect(chartSource({ symbol: "EURUSD", timeframe: "1m", chart: initialChartState("", "1m"), snapshot: snapshot() })).toBe("snapshot");
  });

  it("is empty, never a mislabelled snapshot, when the snapshot is for another market or timeframe", () => {
    const empty = initialChartState("BTCUSD", "1m");
    expect(chartSource({ symbol: "BTCUSD", timeframe: "1m", chart: empty, snapshot: snapshot() })).toBe("empty");
    expect(chartSource({ symbol: "EURUSD", timeframe: "5m", chart: initialChartState("EURUSD", "5m"), snapshot: snapshot() })).toBe("empty");
  });

  it("is empty with no snapshot", () => {
    expect(chartSource({ symbol: "EURUSD", timeframe: "1m", chart: initialChartState("EURUSD", "1m"), snapshot: null })).toBe("empty");
  });

  it("does not paint the previous market's candles right after a switch", () => {
    // Selection moved to 5m but the chart still holds the 1m candles for one frame.
    expect(chartSource({ symbol: "EURUSD", timeframe: "5m", chart: live("EURUSD", "1m"), snapshot: null })).toBe("empty");
    expect(chartSource({ symbol: "BTCUSD", timeframe: "1m", chart: live("EURUSD", "1m"), snapshot: null })).toBe("empty");
  });
});
