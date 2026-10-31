// @vitest-environment jsdom
import { createElement as h, useLayoutEffect, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { ChartBrackets } from "./ChartBrackets";
import type { TradeView } from "@asm/contracts";

vi.mock("@/lib/use-now", () => ({ useNowSec: () => 100 }));
vi.mock("@/components/shell/PlatformProvider", () => ({ usePlatform: () => ({ recordTradeUpdate: vi.fn() }), useQuote: () => ({ price: 100 }) }));
const trade: TradeView = { id: "zoom-trade", accountId: "demo", symbol: "BTCUSDT", direction: "UP", stake: 10000, spreadFee: 500, entryPrice: 100, entryTs: 100, expiryTs: 200, exitPrice: null, payoutPct: 0, durationSec: 100, status: "OPEN", pnl: 0, stopLoss: 90, takeProfit: 110 };
const market = { subscribe: () => () => {}, getSnapshot: () => ({ quotes: { BTCUSDT: { price: 100 } } }) } as any;
let chart: IChartApi, series: ISeriesApi<"Candlestick">;
let frames = new Map<number, FrameRequestCallback>(), nextFrame = 0;
function flush() {
  act(() => {
    for (let n = 0; n < 5; n++) {
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(f => f(performance.now()));
    }
  });
}
function Fixture({ trades = [trade] }: { trades?: TradeView[] }) {
  const canvas = useRef<HTMLDivElement>(null), chartRef = useRef<IChartApi | null>(null), seriesRef = useRef<ISeriesApi<any> | null>(null);
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    chart = createChart(canvas.current!, { width: 1000, height: 600, autoSize: false, layout: { attributionLogo: false }, timeScale: { timeVisible: true } });
    series = chart.addSeries(CandlestickSeries);
    series.setData(Array.from({ length: 40 }, (_, i) => ({ time: (1700000000 + i * 60) as UTCTimestamp, open: i < 20 ? 60 : 100, high: i < 20 ? 65 : 105, low: i < 20 ? 50 : 95, close: i < 20 ? 60 : 100 })));
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: 39 });
    chartRef.current = chart; seriesRef.current = series; setVersion(1);
    return () => chart.remove();
  }, []);
  return h("div", null, h("div", { ref: canvas, "data-testid": "canvas" }), h(ChartBrackets, { trades, seriesRef, chartRef, containerRef: canvas, precision: 2, tickSize: .01, currency: "INR", chartVersion: version, market }));
}
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("PointerEvent", MouseEvent);
  // Stub drawing only. Real chart and price-scale calculations run unchanged.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return new Proxy({ canvas: this, measureText: (text: string) => ({ width: String(text).length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }), createLinearGradient: () => ({ addColorStop() {} }) }, {
      get(target, key) { return key in target ? target[key as keyof typeof target] : () => {}; },
    }) as any;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ trade: { ...trade, takeProfit: 120 } }) })));
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function expectPriceRangeToFollowZoom() {
  const broad = chart.priceScale("right").getVisibleRange()!;
  // A wheel/pinch changes the visible time range. The real chart must also fit
  // price to the candles that remain visible, with or without trade overlays.
  fireEvent.wheel(screen.getByTestId("canvas"));
  act(() => chart.timeScale().setVisibleLogicalRange({ from: 21, to: 39 })); flush();
  const narrow = chart.priceScale("right").getVisibleRange()!;
  expect(narrow.to - narrow.from).toBeLessThan(broad.to - broad.from);
}
it.each([false, true])("keeps vertical auto-fit when a trade opens (saved exits: %s)", exits => {
  const view = render(h(Fixture, { trades: [] })); flush();
  view.rerender(h(Fixture, { trades: [{ ...trade, stopLoss: exits ? 90 : null, takeProfit: exits ? 110 : null }] })); flush();
  expect(chart.priceScale("right").options().autoScale).toBe(true);
  expectPriceRangeToFollowZoom();
});
it.each(["release", "confirm", "cancel", "pointercancel"])("restores real price autoscaling after TP drag and %s without refreshing", async action => {
  render(h(Fixture)); flush();
  const handle = screen.getByRole("button", { name: "Drag TP level" }), y = Number(series.priceToCoordinate(110));
  fireEvent.pointerDown(handle, { clientY: y, pointerId: 1 });
  expect(chart.priceScale("right").options().autoScale).toBe(false);
  fireEvent.pointerMove(handle, { clientY: y - 10, pointerId: 1 }); flush();
  fireEvent(handle, new MouseEvent(action === "pointercancel" ? "pointercancel" : "pointerup", { bubbles: true, clientY: y - 10 })); flush();
  if (action === "confirm") {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await Promise.resolve(); await Promise.resolve(); }); flush();
    expect(fetch).toHaveBeenCalledOnce();
  }
  if (action === "cancel") { fireEvent.click(screen.getByRole("button", { name: "Cancel" })); flush(); }
  expect(chart.priceScale("right").options().autoScale).toBe(true);
  expectPriceRangeToFollowZoom();
});
it("preserves a price scale the user manually adjusted before editing", () => {
  render(h(Fixture)); flush();
  act(() => chart.priceScale("right").setVisibleRange({ from: 80, to: 120 })); flush();
  const handle = screen.getByRole("button", { name: "Drag TP level" }), y = Number(series.priceToCoordinate(110));
  fireEvent.pointerDown(handle, { clientY: y, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: y - 10, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientY: y - 10, pointerId: 1 }); flush();
  expect(chart.priceScale("right").options().autoScale).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
