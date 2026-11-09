import { describe, expect, it } from "vitest";
import type { OtcMarketMessage } from "@asm/contracts";
import { ChartStream } from "./chart-stream";
const bar = (openTs: number, c = 100) => ({ openTs, o: 99, h: 102, l: 98, c });
const packet = (patch: Partial<OtcMarketMessage> = {}): OtcMarketMessage => ({ type: "otc:market", generation: "worker-a", sequence: 1, time: 180000, symbol: "BTCUSDT", timeframe: "1m", reset: true, retainedFrom: 60, candles: [bar(60), bar(120), bar(180)], displayQuote: { token: "q1", price: 100, expiresAt: 1000000 }, reference: null, depth: { bids: [], asks: [] }, tape: [], phase: "normal", activeTobs: 0, ...patch });

describe("native OTC stream", () => {
  it("replaces history on reset, merges every delta and retains closed array on forming updates", () => {
    const stream = new ChartStream(); stream.select("BTCUSDT", "1m");
    stream.apply(packet());
    const history = stream.state.candles;
    stream.apply(packet({ reset: false, sequence: 2, candles: [bar(180, 101)] }));
    expect(stream.state.candles).toBe(history);
    expect(stream.state.forming?.c).toBe(101);
    stream.apply(packet({ reset: false, sequence: 3, time: 240000, candles: [bar(180, 102), bar(240, 103)] }));
    expect(stream.state.candles.map(c => c.openTs)).toEqual([60, 120, 180]);
    expect(stream.state.forming?.c).toBe(103);
  });
  it("never paints an old selection or out-of-order frame", () => {
    const stream = new ChartStream(); stream.select("BTCUSDT", "1m"); stream.apply(packet({ sequence: 10 }));
    const before = stream.state;
    stream.apply(packet({ sequence: 9, candles: [bar(180, 1000)] })); expect(stream.state).toBe(before);
    stream.select("EURUSD", "5m"); const eur = stream.state;
    stream.apply(packet()); expect(stream.state).toBe(eur);
    stream.select("BTCUSDT", "1m"); expect(stream.state.candles).toEqual(before.candles); expect(stream.state.displayQuote).toBeNull();
    expect(stream.cursor("BTCUSDT", "1m")).toEqual({ generation: "worker-a", since: 180 });
  });
  it("invalidates all cached histories after a worker restart", () => {
    const stream = new ChartStream();
    stream.apply({ type: "ready", serverTs: 0, model: "OTC_FIXED", generation: "worker-a" });
    stream.select("BTCUSDT", "1m"); stream.apply(packet()); stream.select("EURUSD", "1m");
    stream.apply({ type: "ready", serverTs: 0, model: "OTC_FIXED", generation: "worker-b" });
    expect(stream.select("BTCUSDT", "1m").candles).toEqual([]);
    stream.apply(packet({ generation: "worker-a", reset: false }));
    // Without a reset there is no trustworthy baseline in a new generation.
    expect(stream.state.candles).toEqual([]);
  });
  it("bounds the cache at six previous selections", () => {
    const stream = new ChartStream();
    stream.select("BTCUSDT", "1m"); stream.apply(packet());
    for (let i = 0; i < 8; i++) stream.select(`M${i}`, "1m");
    expect(stream.select("BTCUSDT", "1m").candles).toEqual([]);
  });
});
