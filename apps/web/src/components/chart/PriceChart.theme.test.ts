// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PriceChart } from "./PriceChart";
import { CHART_TYPES } from "./chart-types";
import { getChartPalette } from "./chart-palette";
import { setTheme } from "@/lib/theme";
import { MarketStore } from "@/components/shell/market-store";

const mocks = vi.hoisted(() => ({ charts: [] as any[], create: vi.fn() }));
vi.mock("./ChartAnalysis", () => ({ ChartAnalysis: () => null }));
vi.mock("./ChartBrackets", () => ({ ChartBrackets: () => null }));
vi.mock("./OtcEntryLines", () => ({ OtcEntryLines: () => null }));
vi.mock("./OtcProtection", () => ({ OtcProtection: () => null }));
vi.mock("./OtcExpiry", () => ({ OtcExpiry: () => null }));
vi.mock("lightweight-charts", async original => {
  const actual = await original<any>();
  return {
    ...actual,
    createTextWatermark: () => ({ applyOptions: vi.fn() }),
    createChart: (...args: any[]) => {
      mocks.create(...args);
      const time = { width: () => 900, height: () => 25, getVisibleLogicalRange: () => ({ from: 0, to: 40 }), setVisibleLogicalRange: vi.fn(), applyOptions: vi.fn(), timeToCoordinate: () => 300,
        subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() };
      const chart: any = { applyOptions: vi.fn(), remove: vi.fn(), removeSeries: vi.fn(), subscribeCrosshairMove: vi.fn(), clearCrosshairPosition: vi.fn(), panes: () => [{}], timeScale: () => time,
        priceScale: () => ({ applyOptions: vi.fn() }), allSeries: [], addSeries: vi.fn(() => add()), addCustomSeries: vi.fn(() => add()) };
      function add() {
        let data: any[] = [];
        const series = { applyOptions: vi.fn(), setData: vi.fn(value => { data = value; }), data: () => data,
          update: vi.fn(value => { const last = data.at(-1); if (last?.time === value.time) data[data.length - 1] = value; else data.push(value); }), priceToCoordinate: () => 120,
          createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })), removePriceLine: vi.fn() };
        chart.allSeries.push(series); return series;
      }
      mocks.charts.push(chart); return chart;
    },
  };
});

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  mocks.create.mockClear(); mocks.charts.length = 0;
  let id = 0; frames = new Map();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.documentElement.dataset.theme = "dark";
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve("src/app/theme-chart.css"), "utf8").replace("@theme", ":root");
  document.head.append(style);
});
afterEach(() => { cleanup(); document.head.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(CHART_TYPES)("changes $id appearance without remounting or subscribing again", ({ id }) => {
  const market = new MarketStore("BTCUSDT", "1m", []);
  market.apply({ type: "candles:history", symbol: "BTCUSDT", timeframe: "1m", candles: [
    { openTs: 1_800_000_000, o: 100, h: 103, l: 99, c: 102 },
    { openTs: 1_800_000_060, o: 102, h: 103, l: 100, c: 101 },
  ], forming: { openTs: 1_800_000_120, o: 101, h: 102, l: 100, c: 101 } });
  const subscribe = vi.spyOn(market, "subscribe");
  render(h(PriceChart, { market, precision: 2, watermark: "BTCUSDT", openTrades: [{ id: "open-position", accountId: "demo", symbol: "BTCUSDT", mode: "OTC_FIXED", direction: "UP", stake: 10000, entryPrice: 100, entryTs: 1_800_000_000, expiryTs: 1_800_003_600, payoutPct: 92, durationSec: 3600, status: "OPEN", exitPrice: null, pnl: 0, stopLoss: 95, takeProfit: 110 }], currency: "INR", chartType: id }));
  const chart = mocks.charts[0], series = chart.allSeries[0];
  const subscriptionCount = subscribe.mock.calls.length;
  const data = series.data().map((bar: any) => ({ ...bar }));
  const rangeWrites = chart.timeScale().setVisibleLogicalRange.mock.calls.length;
  const countdown = screen.getByTestId("chart-countdown");
  const snapshot = market.getSnapshot();
  const seriesCount = chart.allSeries.length;
  const entryLineCount = series.createPriceLine.mock.calls.length;
  const removedLineCount = series.removePriceLine.mock.calls.length;
  const computedStyle = vi.spyOn(window, "getComputedStyle");

  act(() => setTheme("light"));
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(chart.remove).not.toHaveBeenCalled();
  expect(chart.allSeries).toHaveLength(seriesCount);
  expect(series.createPriceLine).toHaveBeenCalledTimes(entryLineCount);
  expect(series.removePriceLine).toHaveBeenCalledTimes(removedLineCount);
  expect(subscribe).toHaveBeenCalledTimes(subscriptionCount);
  expect(chart.timeScale().setVisibleLogicalRange).toHaveBeenCalledTimes(rangeWrites);
  expect(screen.getByTestId("chart-countdown")).toBe(countdown);
  expect(market.getSnapshot()).toBe(snapshot);
  expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ background: expect.objectContaining({ color: "#ffffff" }) }) }));
  expect(JSON.stringify(series.applyOptions.mock.calls.at(-1))).not.toContain("var(");
  const prices = (bar: Record<string, unknown>) => Object.fromEntries(Object.entries(bar).filter(([key]) => !["color", "borderColor", "wickColor"].includes(key)));
  expect(series.data().map(prices)).toEqual(data.map(prices));
  for (let i = 0; i < 100; i++) getChartPalette();
  expect(computedStyle).toHaveBeenCalledTimes(1);

  act(() => setTheme("dark"));
  expect(subscribe).toHaveBeenCalledTimes(subscriptionCount);
  expect(chart.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({ layout: expect.objectContaining({ background: expect.objectContaining({ color: "#0d141b" }) }) }));
  expect(computedStyle).toHaveBeenCalledTimes(2);
});
