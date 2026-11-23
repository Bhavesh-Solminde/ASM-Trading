// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IChartApi } from "lightweight-charts";
import { ChartAnalysis } from "./ChartAnalysis";
import { MarketStore } from "@/components/shell/market-store";

function mockChart() {
  const time = { height: () => 25, subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    subscribeSizeChange: vi.fn(), unsubscribeSizeChange: vi.fn() };
  const added: unknown[] = [];
  const chart = {
    added, timeScale: () => time, priceScale: () => ({ width: () => 60 }), panes: () => [{ getHeight: () => 500 }],
    clearCrosshairPosition: vi.fn(), removeSeries: vi.fn(),
    addSeries: vi.fn(() => { const series = { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn() }; added.push(series); return series; }),
  };
  return chart;
}

function renderAnalysis(chart: ReturnType<typeof mockChart>) {
  const chartRef = { current: chart as unknown as IChartApi | null };
  const container = document.createElement("div");
  document.body.append(container);
  const view = render(h(ChartAnalysis, {
    chartRef, seriesRef: { current: null }, containerRef: { current: container }, market: new MarketStore("BTCUSDT", "1m", []),
    chartVersion: 1, scope: "BTCUSDT", symbol: "BTCUSDT", precision: 2, volumeAvailable: false, volumeEnabled: false, onVolumeChange: () => {},
  }));
  return { chartRef, unmount: view.unmount };
}

beforeEach(() => {
  localStorage.setItem("asm_chart_indicators:BTCUSDT", JSON.stringify(["SMA", "RSI"]));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it("leaves a removed chart alone when the indicators unmount", () => {
  const chart = mockChart();
  const { chartRef, unmount } = renderAnalysis(chart);
  expect(chart.added).toHaveLength(2);
  chart.clearCrosshairPosition.mockClear();

  chartRef.current = null; // PriceChart's teardown removes the chart before this cleanup runs.
  unmount();
  expect(chart.clearCrosshairPosition).not.toHaveBeenCalled();
  expect(chart.removeSeries).not.toHaveBeenCalled();
});

it("still removes indicator series from a live chart", () => {
  const chart = mockChart();
  const { unmount } = renderAnalysis(chart);
  chart.clearCrosshairPosition.mockClear();

  unmount();
  expect(chart.clearCrosshairPosition).toHaveBeenCalledTimes(1);
  expect(chart.removeSeries.mock.calls.map(call => call[0])).toEqual(chart.added);
});
