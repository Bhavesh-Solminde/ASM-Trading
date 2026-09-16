import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketStore } from "./market-store";

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushFrame(): void {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
}

const assets = [
  { symbol: "EURUSD", payoutPct: 92 },
  { symbol: "USDJPY", payoutPct: 88 },
];

describe("MarketStore", () => {
  it("notifies listeners once per frame however many ticks arrive", () => {
    const store = new MarketStore("EURUSD", "1m", assets);
    const listener = vi.fn();
    store.subscribe(listener);

    store.apply({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
    store.apply({ type: "tick", symbol: "USDJPY", price: 150, ts: 1 });
    store.apply({ type: "tick", symbol: "EURUSD", price: 1.2, ts: 2 });
    expect(listener).not.toHaveBeenCalled();

    flushFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().chart.lastPrice).toBe(1.2);
    expect(store.getSnapshot().quotes.USDJPY!.price).toBe(150);
  });

  it("keeps the snapshot and schedules nothing for messages that change nothing", () => {
    const store = new MarketStore("EURUSD", "1m", assets);
    const before = store.getSnapshot();
    store.apply({ type: "tick", symbol: "UNKNOWN", price: 1, ts: 1 });
    expect(store.getSnapshot()).toBe(before);
    expect(frames).toHaveLength(0);
  });

  it("resets the chart when the symbol changes but keeps every quote", () => {
    const store = new MarketStore("EURUSD", "1m", assets);
    store.apply({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
    store.selectSymbol("USDJPY");
    const { chart, quotes } = store.getSnapshot();
    expect(chart.symbol).toBe("USDJPY");
    expect(chart.lastPrice).toBeNull();
    expect(quotes.EURUSD!.price).toBe(1.1);
  });
});
