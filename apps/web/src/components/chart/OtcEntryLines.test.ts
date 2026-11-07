// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { TIMEFRAME_SEC, type CandleDto, type Timeframe, type TradeView } from "@asm/contracts";
import { MarketStore } from "@/components/shell/market-store";
import { OtcEntryLines } from "./OtcEntryLines";

const C1 = 1_800_000_000; // An exact hour boundary.
const bar = (openTs: number): CandleDto => ({ openTs, o: 100, h: 102, l: 98, c: 101 });
const nativeBar = (b: CandleDto) => ({ time: b.openTs as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
const trade: TradeView = {
  id: "entry", accountId: "demo", symbol: "BTCUSDT", mode: "OTC_FIXED",
  direction: "UP", stake: 10000, entryPrice: 100, entryTs: C1 + 59,
  expiryTs: C1 + 89, payoutPct: 92, durationSec: 30, status: "OPEN", exitPrice: null, pnl: 0,
};
let chart: IChartApi;
let series: ISeriesApi<"Candlestick">;
let market: MarketStore;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function flush() {
  act(() => {
    for (let i = 0; i < 6; i++) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(performance.now()));
    }
  });
}

function setup(timeframe: Timeframe = "1m") {
  const period = TIMEFRAME_SEC[timeframe];
  const candles = Array.from({ length: 39 }, (_, i) => bar(C1 - (39 - i) * period));
  market = new MarketStore("BTCUSDT", timeframe, []);
  market.apply({ type: "candles:history", symbol: "BTCUSDT", timeframe, candles, forming: bar(C1) });
  const container = document.createElement("div");
  document.body.append(container);
  chart = createChart(container, { width: 1000, height: 600, layout: { attributionLogo: false }, timeScale: { timeVisible: true } });
  series = chart.addSeries(CandlestickSeries);
  series.setData([...candles, bar(C1)].map(nativeBar));
  chart.timeScale().setVisibleLogicalRange({ from: 0, to: 43 });
  flush();
  return {
    props: { chartRef: { current: chart }, seriesRef: { current: series }, market, chartVersion: 1 },
    appendNext() {
      const next = bar(C1 + period);
      series.update(nativeBar(next));
      market.apply({ type: "candles:history", symbol: "BTCUSDT", timeframe, candles: [...candles, bar(C1)], forming: next });
      flush();
    },
  };
}

function entryX(label = "Buy entry") {
  const line = screen.getByLabelText(label);
  expect(line.hidden).toBe(false);
  return Number(/translate\(([^p]+)px/.exec(line.style.transform)?.[1]);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {} }));
  // Only canvas painting is stubbed. Candle coordinates and viewport math are real.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return new Proxy({ canvas: this, measureText: (text: string) => ({ width: String(text).length * 7 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
      get(target, key) { return key in target ? target[key as keyof typeof target] : () => {}; },
    }) as any;
  });
});

afterEach(() => {
  cleanup();
  chart?.remove();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["1m", "5m", "15m", "1h"] as const)("keeps Buy and Sell entries one second before the %s boundary on C1", timeframe => {
  const fixture = setup(timeframe);
  const entryTs = C1 + TIMEFRAME_SEC[timeframe] - 1;
  render(h(OtcEntryLines, { ...fixture.props, trades: [
    { ...trade, entryTs }, { ...trade, id: "sell", direction: "DOWN", entryTs, entryPrice: 101 },
  ] }));
  flush();
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate(C1 as UTCTimestamp));
  expect(entryX("Sell entry")).toBe(entryX());
  const range = chart.timeScale().getVisibleLogicalRange();
  const setRange = vi.spyOn(chart.timeScale(), "setVisibleLogicalRange");
  const setData = vi.spyOn(series, "setData");
  fixture.appendNext();
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate(C1 as UTCTimestamp));
  expect(entryX("Sell entry")).toBe(entryX());
  expect(entryX()).toBeLessThan(Number(chart.timeScale().timeToCoordinate((C1 + TIMEFRAME_SEC[timeframe]) as UTCTimestamp)));
  const after = chart.timeScale().getVisibleLogicalRange();
  expect(Number(after?.to) - Number(after?.from)).toBe(Number(range?.to) - Number(range?.from));
  expect(setRange).not.toHaveBeenCalled();
  expect(setData).not.toHaveBeenCalled();
});

it("uses the recorded C1 entry when the trade response arrives after C2 starts", () => {
  const fixture = setup();
  fixture.appendNext();
  render(h(OtcEntryLines, { ...fixture.props, trades: [trade] }));
  flush();
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate(C1 as UTCTimestamp));
});

it("places a trade accepted exactly at the boundary on C2", () => {
  const fixture = setup();
  fixture.appendNext();
  render(h(OtcEntryLines, { ...fixture.props, trades: [{ ...trade, entryTs: C1 + 60 }] }));
  flush();
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate((C1 + 60) as UTCTimestamp));
});

it("follows pan and zoom without changing the entry candle or entry price", () => {
  const fixture = setup();
  render(h(OtcEntryLines, { ...fixture.props, trades: [trade] }));
  flush();
  const before = entryX();
  act(() => chart.timeScale().setVisibleLogicalRange({ from: 30, to: 42 }));
  flush();
  expect(entryX()).not.toBe(before);
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate(C1 as UTCTimestamp));
  expect(screen.getByLabelText("Buy entry").style.transform).toBe(
    `translate(${entryX()}px, ${series.priceToCoordinate(trade.entryPrice)}px)`,
  );
});

it("hides an old symbol immediately on switching markets", () => {
  const fixture = setup();
  render(h(OtcEntryLines, { ...fixture.props, trades: [trade] }));
  flush();
  market.selectSymbol("ETHUSDT");
  flush();
  expect(screen.getByLabelText("Buy entry").hidden).toBe(true);
});

it("waits for the entry candle instead of placing the trade on an adjacent candle", () => {
  const fixture = setup();
  render(h(OtcEntryLines, { ...fixture.props, trades: [{ ...trade, entryTs: C1 + 60 }] }));
  flush();
  expect(screen.getByLabelText("Buy entry").hidden).toBe(true);
  fixture.appendNext();
  expect(entryX()).toBe(chart.timeScale().timeToCoordinate((C1 + 60) as UTCTimestamp));
});
