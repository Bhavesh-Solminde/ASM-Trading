// @vitest-environment jsdom
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LineStyle, type AutoscaleInfoProvider } from "lightweight-charts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OtcSetStopsInput, TradeView } from "@asm/contracts";
import { initialTradeState } from "@asm/client-core";

const store = vi.hoisted(() => ({ record: vi.fn(), now: 100 }));
vi.mock("@/components/shell/PlatformProvider", async original => ({
  ...await original<typeof import("@/components/shell/PlatformProvider")>(),
  usePlatform: () => ({ recordTradeUpdate: store.record }),
}));
vi.mock("@/lib/use-now", () => ({ useNowSec: () => store.now }));
vi.mock("@/lib/theme", () => ({ readTheme: () => "dark", useTheme: () => "dark" }));
import { OtcTradeStops } from "./OtcTradeStops";
import { tradeReducer } from "@/components/shell/PlatformProvider";

const trade: TradeView = {
  id: "trade-1", accountId: "demo", symbol: "XAUUSD", direction: "UP", stake: 10000, payoutPct: 92,
  entryPrice: 100, entryTs: 90, expiryTs: 140, durationSec: 50, exitPrice: null, status: "OPEN", pnl: 0, mode: "OTC_FIXED",
};
const frame = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frame.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup(); frame.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); store.now = 100;
});

function paint() {
  for (let i = 0; i < 6; i++) act(() => {
    const callbacks = [...frame.values()]; frame.clear();
    for (const callback of callbacks) callback(0);
  });
}

function fixture(initial: TradeView = trade, overlayTop?: number) {
  const dock = document.createElement("div"), container = document.createElement("div");
  document.body.append(dock);
  Object.defineProperty(container, "clientHeight", { value: 200 });
  const lines = [vi.fn(), vi.fn()];
  const createPriceLine = vi.fn()
    .mockReturnValueOnce({ applyOptions: lines[0] })
    .mockReturnValueOnce({ applyOptions: lines[1] });
  const removePriceLine = vi.fn();
  const overlay = document.createElement("div");
  if (overlayTop !== undefined) vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(new DOMRect(0, overlayTop, 200, 48));
  const bottomOverlayRef = { current: overlay };
  const applyOptions = vi.fn();
  const setAutoScale = vi.fn();
  const originalProvider: AutoscaleInfoProvider = base => base();
  const seriesRef = { current: {
    createPriceLine, removePriceLine, applyOptions, options: () => ({ autoscaleInfoProvider: originalProvider }),
    coordinateToPrice: (y: number) => 200 - y, priceToCoordinate: (p: number) => 200 - p,
  } } as any;
  const chartRef = { current: {
    paneSize: () => ({ height: 200 }), priceScale: () => ({
      width: () => 55, setAutoScale, options: () => ({ scaleMargins: { top: .24, bottom: .22 } }),
    }),
    timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() }),
    subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
  } } as any;
  let currentPrice = 100, onPrice = () => {};
  const market = {
    getSnapshot: () => ({ chart: { symbol: trade.symbol, lastPrice: currentPrice } }),
    subscribe: (fn: () => void) => { onPrice = fn; return () => {}; },
  } as any;
  const containerRef = { current: container };
  let socketUpdate = (_: TradeView) => {};
  function Harness() {
    const [state, setState] = useState(() => initialTradeState([initial], {}));
    store.record.mockImplementation((trade: TradeView, expected: OtcSetStopsInput) => {
      setState(current => tradeReducer(current, { kind: "stopSave", trade, expected }));
    });
    socketUpdate = trade => setState(current => tradeReducer(current, { kind: "message", message: { type: "trade:opened", trade } }));
    return h(OtcTradeStops, { trade: state.tradesByAccount[initial.accountId]![0]!, seriesRef, chartRef, containerRef, bottomOverlayRef, market, chartVersion: 1, precision: 2, tickSize: .01, actionsContainer: dock });
  }
  const ui = render(h(Harness));
  paint();
  return { ...ui, lines, createPriceLine, removePriceLine, applyOptions, originalProvider, setAutoScale,
    receiveTrade: (trade: TradeView) => act(() => socketUpdate(trade)),
    quote: (price: number) => { currentPrice = price; onPrice(); paint(); } };
}

function succeed(trade: TradeView, options: RequestInit) {
  const { takeProfit, stopLoss } = JSON.parse(String(options.body)) as OtcSetStopsInput;
  return { ok: true, status: 200, json: async () => ({ trade: { ...trade, takeProfit, stopLoss } }) };
}

async function click(name: string) {
  await act(async () => fireEvent.click(screen.getByRole("button", { name })));
  paint();
}

it("starts with uncommitted drafts and sets, updates and removes levels through the trade endpoint", async () => {
  const post = vi.fn((_url: string, options: RequestInit) => Promise.resolve(succeed(trade, options)));
  vi.stubGlobal("fetch", post);
  const { lines, createPriceLine } = fixture();
  const sl = () => screen.getByRole("slider", { name: "Drag stop loss" });
  const tp = () => screen.getByRole("slider", { name: "Drag take profit" });
  expect(sl().textContent).toBe("SL draft");
  expect(tp().getAttribute("aria-valuenow")).toBe("118");
  expect(lines[0]).toHaveBeenLastCalledWith(expect.objectContaining({ price: 82, lineStyle: LineStyle.Dashed }));
  expect(post).not.toHaveBeenCalled();
  fireEvent.keyDown(tp(), { key: "ArrowUp", shiftKey: true });
  paint();
  await click("Set");
  expect(sl().textContent).toBe("SL");
  expect(tp().textContent).toBe("TP");
  expect(lines[1]).toHaveBeenLastCalledWith(expect.objectContaining({ lineVisible: false }));

  fireEvent.keyDown(sl(), { key: "ArrowDown", shiftKey: true });
  paint();
  expect(sl().textContent).toBe("SL draft");
  await click("Cancel");
  expect(sl().getAttribute("aria-valuenow")).toBe("82");
  fireEvent.keyDown(sl(), { key: "ArrowDown", shiftKey: true });
  paint();
  await click("Update");
  expect(sl().getAttribute("aria-valuenow")).toBe("81.9");
  await click("Remove take profit");
  expect(screen.queryByRole("slider", { name: "Drag take profit" })).toBeNull();
  expect(sl().textContent).toBe("SL");
  await click("Remove");
  expect(screen.queryAllByRole("slider")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Set SL / TP" })).toBeTruthy();
  expect(createPriceLine).toHaveBeenCalledTimes(2);
  expect(post.mock.calls.map(([url]) => url)).toEqual(Array(4).fill("/api/trades/trade-1/stops"));
  const requests = post.mock.calls.map(([, options]) => JSON.parse(String(options.body)) as OtcSetStopsInput);
  expect(new Set(requests.map(request => request.requestId)).size).toBe(4);
  expect(requests.at(-1)).toMatchObject({ stopLoss: null, takeProfit: null });
});

it("keeps a newer socket stop edit when the earlier HTTP reply arrives", async () => {
  const initial = { ...trade, stopLoss: 90, takeProfit: 120 };
  const staleReply = { ...initial, stopLoss: 89.9 };
  let reply!: (response: unknown) => void;
  const post = vi.fn(() => new Promise(resolve => { reply = resolve; }));
  vi.stubGlobal("fetch", post);
  const { receiveTrade } = fixture(initial);
  const stop = () => screen.getByRole("slider", { name: "Drag stop loss" });
  fireEvent.keyDown(stop(), { key: "ArrowDown", shiftKey: true });
  await click("Update");
  expect(post).toHaveBeenCalledOnce();
  receiveTrade({ ...initial, stopLoss: 87, takeProfit: 124 });

  await act(async () => reply({ ok: true, status: 200, json: async () => ({ trade: staleReply }) }));
  paint();
  expect(store.record).toHaveBeenCalledWith(staleReply, { stopLoss: 90, takeProfit: 120 });
  expect(stop().getAttribute("aria-valuenow")).toBe("87");
  expect(screen.getByRole("slider", { name: "Drag take profit" }).getAttribute("aria-valuenow")).toBe("124");
});

it("allows a one-sided draft, clamps it on live price moves, and shows the engine refusal", async () => {
  const post = vi.fn((_url: string, _options: RequestInit) => Promise.resolve({ ok: false, status: 409, json: async () => ({ error: "The trade has already ended." }) }));
  vi.stubGlobal("fetch", post);
  const { quote } = fixture();
  await click("Remove take profit");
  expect(post).not.toHaveBeenCalled();
  quote(81);
  expect(screen.getByRole("slider", { name: "Drag stop loss" }).getAttribute("aria-valuenow")).toBe("80.99");
  await click("Set");
  expect(screen.getByRole("alert").textContent).toBe("The trade has already ended.");
  expect(screen.getByRole("slider", { name: "Drag stop loss" }).textContent).toBe("SL draft");
  expect(store.record).not.toHaveBeenCalled();
  expect(JSON.parse(String(post.mock.calls[0]![1].body))).toMatchObject({ stopLoss: 80.99, takeProfit: null });
});

it("fits active and edited prices above the phone overlay and restores regular fitting on exit", () => {
  const view = fixture({ ...trade, stopLoss: 50, takeProfit: 130 }, 120);
  const { autoscaleInfoProvider }: { autoscaleInfoProvider: AutoscaleInfoProvider } = view.applyOptions.mock.calls[0]![0];
  const base = () => ({ priceRange: { minValue: 90, maxValue: 110 }, margins: { above: 3, below: 2 } });
  expect(autoscaleInfoProvider(base)).toEqual({
    priceRange: { minValue: 50, maxValue: 130 }, margins: { above: 3, below: 60 },
  });
  const stop = screen.getByRole("slider", { name: "Drag stop loss" });
  expect(stop.parentElement?.style.top).toBe("96px");
  fireEvent.keyDown(stop, { key: "ArrowDown", shiftKey: true });
  paint();
  expect(autoscaleInfoProvider(base)?.priceRange?.minValue).toBe(49.9);
  expect(stop.parentElement?.style.top).toBe("96px");
  view.unmount();
  expect(view.applyOptions).toHaveBeenLastCalledWith({ autoscaleInfoProvider: view.originalProvider });
});

it("keeps the existing desktop scale when the tool row is hidden", () => {
  const view = fixture({ ...trade, stopLoss: 50 });
  expect(view.applyOptions).not.toHaveBeenCalled();
  expect(view.setAutoScale).not.toHaveBeenCalled();
  expect(screen.getByRole("slider", { name: "Drag stop loss" }).parentElement?.style.top).toBe("150px");
});
