// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TradeView } from "@asm/contracts";
import { PriceChart } from "./PriceChart";
import { MarketStore } from "@/components/shell/market-store";

const mocks = vi.hoisted(() => ({ charts: [] as any[] }));
vi.mock("./ChartAnalysis", () => ({ ChartAnalysis: () => null }));
vi.mock("./ChartBrackets", () => ({ ChartBrackets: () => null }));
vi.mock("./OtcEntryLines", () => ({ OtcEntryLines: () => null }));
vi.mock("./OtcTradeStops", () => ({ OtcTradeStops: () => null }));
vi.mock("./OtcExpiry", () => ({ OtcExpiry: () => null }));
vi.mock("lightweight-charts", async original => {
  const actual = await original<any>();
  return {
    ...actual,
    createTextWatermark: () => ({ applyOptions: vi.fn() }),
    createChart: () => {
      const time = { width: () => 900, height: () => 25, getVisibleLogicalRange: () => ({ from: 0, to: 40 }), setVisibleLogicalRange: vi.fn(), applyOptions: vi.fn(), timeToCoordinate: () => 300,
        subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() };
      const chart: any = { applyOptions: vi.fn(), remove: vi.fn(), removeSeries: vi.fn(), subscribeCrosshairMove: vi.fn(), clearCrosshairPosition: vi.fn(), panes: () => [{}], timeScale: () => time,
        priceScale: () => ({ applyOptions: vi.fn() }), allSeries: [], addSeries: vi.fn(() => add()), addCustomSeries: vi.fn(() => add()) };
      function add() {
        const series = { applyOptions: vi.fn(), setData: vi.fn(), data: () => [], update: vi.fn(), priceToCoordinate: () => 120,
          createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })), removePriceLine: vi.fn() };
        chart.allSeries.push(series); return series;
      }
      mocks.charts.push(chart); return chart;
    },
  };
});

const trade: TradeView = {
  id: "open-position", accountId: "demo", symbol: "BTCUSDT", mode: "OTC_FIXED", direction: "UP", stake: 10000,
  entryPrice: 100, entryTs: 1_800_000_000, expiryTs: 1_800_003_600, payoutPct: 92, durationSec: 3600,
  status: "OPEN", exitPrice: null, pnl: 0, stopLoss: 95, takeProfit: 110,
};

function renderChart(openTrades: TradeView[]) {
  const market = new MarketStore("BTCUSDT", "1m", []);
  market.apply({ type: "candles:history", symbol: "BTCUSDT", timeframe: "1m", candles: [
    { openTs: 1_800_000_000, o: 100, h: 103, l: 99, c: 102 },
  ], forming: { openTs: 1_800_000_060, o: 102, h: 103, l: 100, c: 101 } });
  const props = { market, precision: 2, watermark: "BTCUSDT", currency: "INR", chartType: "candles" as const };
  const view = render(h(PriceChart, { ...props, openTrades }));
  const chart = mocks.charts[0], series = chart.allSeries[0];
  return { chart, series, rerender: (next: TradeView[]) => view.rerender(h(PriceChart, { ...props, openTrades: next })), unmount: view.unmount };
}

beforeEach(() => {
  mocks.charts.length = 0;
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The entry, SL and TP lines currently drawn for `trade` (the effect redraws them while the chart settles). */
function tradeLines(series: any) {
  const titled = (title: string) => series.createPriceLine.mock.calls.findLastIndex(([options]: [{ title?: string }]) => options.title === title);
  return ["▲ ₹100.00", "SL", "TP"].map(title => series.createPriceLine.mock.results[titled(title)]?.value);
}

it("leaves the removed chart's trade lines alone when the chart unmounts", () => {
  const { chart, series, unmount } = renderChart([trade]);
  expect(tradeLines(series)).not.toContain(undefined);

  unmount();
  expect(chart.remove).toHaveBeenCalledTimes(1);
  const removedAt = chart.remove.mock.invocationCallOrder[0];
  expect(series.removePriceLine.mock.invocationCallOrder.filter((order: number) => order > removedAt)).toEqual([]);
});

it("still removes a trade's lines from the live chart when the trade closes", () => {
  const { chart, series, rerender } = renderChart([trade]);
  const lines = tradeLines(series);
  series.removePriceLine.mockClear();

  rerender([]);
  expect(chart.remove).not.toHaveBeenCalled();
  expect(series.removePriceLine.mock.calls.map((call: unknown[]) => call[0])).toEqual(lines);
});
