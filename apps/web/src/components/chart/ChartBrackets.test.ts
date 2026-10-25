// @vitest-environment jsdom
import { createElement as h, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "@asm/contracts";
import { ChartBrackets } from "./ChartBrackets";

const state = vi.hoisted(() => ({ now: 100, price: 100, record: vi.fn() }));
vi.mock("@/lib/use-now", () => ({ useNowSec: () => state.now }));
vi.mock("@/components/shell/PlatformProvider", () => ({ usePlatform: () => ({ recordTradeUpdate: state.record }), useQuote: () => ({ price: state.price }) }));
const trade: TradeView = { id: "one", accountId: "demo", symbol: "BTCUSDT", direction: "UP", stake: 10000, spreadFee: 5, entryPrice: 100, entryTs: 100, expiryTs: 200, exitPrice: null, payoutPct: 0, durationSec: 100, status: "OPEN", pnl: 0, stopLoss: null, takeProfit: null };
const second = { ...trade, id: "two", direction: "DOWN" as const, entryPrice: 110, expiryTs: 400 };
let width = 1000;
let frames: FrameRequestCallback[] = [];
let observers: (() => void)[] = [];
let lines: { options: any; applyOptions: any }[] = [];
const scale = { options: () => ({ autoScale: true }), applyOptions: vi.fn(), width: () => 65, getVisibleRange: () => ({ from: 20, to: 240 }), setVisibleRange: vi.fn() };
const timeScale = { height: () => 25, subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() };
const chart = { options: () => ({ handleScroll: true, handleScale: true }), applyOptions: vi.fn(), priceScale: () => scale, timeScale: () => timeScale, subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn() };
const series = { priceToCoordinate: (p: number) => 500 - p * 2, coordinateToPrice: (y: number) => (500 - y) / 2, options: () => ({}), applyOptions: vi.fn(), removePriceLine: vi.fn(), createPriceLine: (options: any) => { const line = { options, applyOptions: vi.fn((next: any) => { line.options = next; }) }; lines.push(line); return line; } };
const market = { getSnapshot: () => ({ quotes: { BTCUSDT: { price: state.price } } }), subscribe: () => () => {} } as any;
function Fixture({ trades = [trade], scope = "demo:BTC", enabled = true, focusedTradeId, onShowAllTrades }: { focusedTradeId?: string; onShowAllTrades?: () => void; trades?: TradeView[]; scope?: string; enabled?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  return h("section", null, h("div", { "data-testid": "chart-parent" },
    h("div", { ref: containerRef, "data-testid": "canvas" }),
    h(ChartBrackets, { actionsContainer, key: `${scope}:${enabled}`, trades, controlsEnabled: enabled, ...(focusedTradeId ? { focusedTradeId } : {}), ...(onShowAllTrades ? { onShowAllTrades } : {}), seriesRef: { current: series } as any, chartRef: { current: chart } as any, containerRef, precision: 2, tickSize: .01, currency: "INR", chartVersion: 1, market })), h("div", { ref: setActionsContainer, "data-testid": "actions-dock" }));
}
function flush() { act(() => { for (let i = 0; i < 3; i++) { const pending = frames; frames = []; pending.forEach(f => f(0)); } }); }
function resize(next: number) { width = next; act(() => observers.forEach(fn => fn())); flush(); }
function open() { fireEvent.click(screen.getAllByRole("button", { name: "Edit position protection" })[0]!); flush(); }
function enableTP() { fireEvent.click(screen.getByRole("checkbox", { name: "Enable TP" })); }
function editorReservation() { return screen.getByTestId("canvas").dataset.protectionEditor ?? ""; }
function requestBody() { return JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); flush(); }

beforeEach(() => {
  state.now = 100; state.price = 100; state.record.mockReset(); width = 1000; frames = []; observers = []; lines = [];
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(callback: () => void) { this.callback = callback; observers.push(callback); } observe() {} disconnect() { observers = observers.filter(fn => fn !== this.callback); } });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("PointerEvent", MouseEvent);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.dataset.testid === "canvas" ? width - (this.dataset.protectionEditor === "open" && width >= 760 ? 318 : 0) : width; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => true; HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("position protection interaction edge cases", () => {
  it("1. opening and dismissing an untouched editor never creates default SL/TP", () => {
    render(h(Fixture)); flush();
    for (const action of ["Cancel", "Close protection editor", "Escape"]) {
      open(); expect(editorReservation()).toBe("open");
      expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
      expect((screen.getByRole("checkbox", { name: "Enable SL" }) as HTMLInputElement).checked).toBe(false);
      if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else fireEvent.click(screen.getByRole("button", { name: action }));
      expect(screen.queryByRole("dialog")).toBeNull(); expect(editorReservation()).toBe("");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("2. discards new or changed protection on Cancel, X and Escape; retains saved lines", () => {
    render(h(Fixture, { trades: [{ ...trade, stopLoss: 90 }] })); flush();
    for (const action of ["Cancel", "Close protection editor", "Escape"]) {
      open(); enableTP(); fireEvent.change(screen.getByRole("spinbutton", { name: "SL price" }), { target: { value: "95" } });
      if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else fireEvent.click(screen.getByRole("button", { name: action }));
      open(); expect((screen.getByRole("spinbutton", { name: "SL price" }) as HTMLInputElement).value).toBe("90");
      expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    }
    expect(fetch).not.toHaveBeenCalled(); expect(trade.takeProfit).toBeNull();
  });
  it("3. restores full chart width when an untouched editor's last position expires", () => {
    const ui = render(h(Fixture)); flush(); open(); state.now = 200; ui.rerender(h(Fixture)); flush();
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByTestId("chart-trading")).toBeNull(); expect(editorReservation()).toBe(""); expect(fetch).not.toHaveBeenCalled();
  });
  it("4. expiry while dragging restores pan/zoom and never transfers a draft to another trade", () => {
    const ui = render(h(Fixture, { trades: [trade, second] })); flush();
    const handle = screen.getByRole("button", { name: "Add TP to Buy position" });
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1 }); fireEvent.pointerMove(handle, { clientY: 280, pointerId: 1 });
    expect(chart.applyOptions).not.toHaveBeenCalled(); expect(scale.applyOptions).toHaveBeenCalledWith({ autoScale: false });
    state.now = 200; ui.rerender(h(Fixture, { trades: [trade, second] })); flush();
    expect(chart.applyOptions).not.toHaveBeenCalled(); expect(scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true });
    open(); expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Sell ₹100.00 @ 110.00/)).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
  it("5. switches multiple positions explicitly without leaking unconfirmed or saved levels", async () => {
    render(h(Fixture, { trades: [trade, { ...second, stopLoss: 120 }] })); flush(); open(); enableTP();
    fireEvent.change(screen.getByRole("combobox", { name: "Protection editor position" }), { target: { value: "two" } }); flush();
    expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("spinbutton", { name: "SL price" }) as HTMLInputElement).value).toBe("120");
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable SL" }));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ trade: { ...second, stopLoss: null } }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await settle();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/cfd/trades/two"); expect(requestBody()).toEqual({ stopLoss: null });
  });
  it("6. account, symbol, timeframe or chart-type scope changes release editor space and old requests", async () => {
    const ui = render(h(Fixture)); flush(); open(); enableTP();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    ui.rerender(h(Fixture, { scope: "other-account:ETH:5m:line" })); flush();
    expect(signal.aborted).toBe(true); expect(editorReservation()).toBe(""); expect(screen.queryByRole("dialog")).toBeNull();
    finish({ ok: true, json: async () => ({ trade: { ...trade, takeProfit: 110 } }) } as Response); await settle();
    expect(state.record).not.toHaveBeenCalled(); open(); expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
  });
  it("7. desktop/phone resizing and disabling controls never leave a reserved chart column", () => {
    const ui = render(h(Fixture)); flush(); open(); expect(editorReservation()).toBe("open");
    resize(390); expect(editorReservation()).toBe("open"); expect(screen.getByTestId("canvas").clientWidth).toBe(390); resize(1456); expect(editorReservation()).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "Close protection editor" })); expect(editorReservation()).toBe("");
    open(); enableTP(); ui.rerender(h(Fixture, { enabled: false })); flush();
    expect(editorReservation()).toBe(""); expect(screen.queryByRole("dialog")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    ui.rerender(h(Fixture)); flush(); open(); expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false);
  });
  it("8. double confirmation sends one request; expiry ignores its late response and restores width", async () => {
    const ui = render(h(Fixture)); flush(); open(); enableTP();
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); }); expect(fetch).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    state.now = 200; ui.rerender(h(Fixture)); flush(); expect(editorReservation()).toBe(""); expect(signal.aborted).toBe(true);
    finish({ ok: true, json: async () => ({ trade: { ...trade, takeProfit: 110 } }) } as Response); await settle();
    expect(state.record).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("9. server rejection and a stalled connection retain saved protection and permit retry/cancel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); render(h(Fixture, { trades: [{ ...trade, stopLoss: 90 }] })); flush(); open(); enableTP();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "invalid_stops" }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); await settle();
    expect(screen.getByRole("alert").textContent).toContain("market moved");
    expect((screen.getByRole("spinbutton", { name: "SL price" }) as HTMLInputElement).value).toBe("90");
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" })); act(() => vi.advanceTimersByTime(15000));
    expect(screen.getByRole("alert").textContent).toContain("timed out");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(editorReservation()).toBe(""); expect(state.record).not.toHaveBeenCalled();
  });
  it("10. cancelled pointer gestures and invalid/cleared fields cannot accidentally save a default", () => {
    render(h(Fixture)); flush(); const handle = screen.getByRole("button", { name: "Add TP to Buy position" });
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1 }); fireEvent.pointerMove(handle, { clientY: 280, pointerId: 1 }); fireEvent.pointerCancel(handle, { pointerId: 1 }); flush();
    expect(chart.applyOptions).not.toHaveBeenCalled(); expect(scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true }); expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    open(); enableTP(); fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit position protection" }));
    expect((screen.getByRole("spinbutton", { name: "TP price" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "110" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP reward" }), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "112" } });
    expect((screen.getByRole("spinbutton", { name: "TP reward" }) as HTMLInputElement).value).toBe("12");
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close protection editor" })); open();
    expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
});

// Real chart options are mutable, and coordinate conversion can leave the plot.
// These cases exercise those boundaries rather than assuming every label stays visible.
describe("offscreen exits and interrupted drags", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    ["takeProfit", "TP", "UP", 900, -500],
    ["takeProfit", "TP", "DOWN", 10, 1000],
    ["stopLoss", "SL", "DOWN", 900, -500],
    ["stopLoss", "SL", "UP", 10, 1000],
  ] as const)("keeps offscreen %s for %s / %s editable at its exact price", (kind, label, direction, level, y) => {
    vi.spyOn(series, "priceToCoordinate").mockImplementation(p => p === level ? y : 300);
    render(h(Fixture, { trades: [{ ...trade, direction, [kind]: level }] })); flush();
    expect(screen.getByRole("button", { name: `${label} at ${level.toFixed(2)} outside chart` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Fit ${label} in chart` }));
    expect(series.applyOptions).toHaveBeenLastCalledWith({ autoscaleInfoProvider: expect.any(Function) });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the captured label mounted when dragging TP beyond the top and never disables chart navigation", () => {
    render(h(Fixture, { trades: [{ ...trade, takeProfit: 110 }] })); flush();
    const handle = screen.getByRole("button", { name: "Drag TP level" });
    fireEvent.pointerDown(handle, { clientY: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: -300, pointerId: 1 }); flush();
    expect(screen.getByRole("button", { name: "Drag TP level" })).toBe(handle);
    expect(screen.getByRole("button", { name: "TP at 400.00 outside chart" })).toBeTruthy();
    fireEvent.pointerUp(handle, { clientY: -300, pointerId: 1 }); flush();
    expect(chart.applyOptions).not.toHaveBeenCalled();
    expect(scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: false });
    expect(scale.setVisibleRange).toHaveBeenLastCalledWith(expect.objectContaining({ to: expect.any(Number) }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); flush();
    expect(screen.queryByRole("button", { name: "Fit TP in chart" })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["blur", "pointerup", "pointercancel"] as const)("restores scale and saved protection after window %s interrupts a drag", event => {
    render(h(Fixture, { trades: [{ ...trade, takeProfit: 110 }] })); flush();
    const handle = screen.getByRole("button", { name: "Drag TP level" });
    fireEvent.pointerDown(handle, { clientY: 280, pointerId: 1 }); fireEvent.pointerMove(handle, { clientY: 270, pointerId: 1 });
    fireEvent(window, new Event(event)); flush();
    expect(scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true }); expect(chart.applyOptions).not.toHaveBeenCalled();
    open(); expect((screen.getByRole("spinbutton", { name: "TP price" }) as HTMLInputElement).value).toBe("110"); expect(fetch).not.toHaveBeenCalled();
  });
  it("recovers cleanly when the browser rejects pointer capture", () => {
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(() => { throw new Error("pointer ended"); });
    render(h(Fixture)); flush(); fireEvent.pointerDown(screen.getByRole("button", { name: "Add TP to Buy position" }), { clientY: 300, pointerId: 1 }); flush();
    expect(scale.applyOptions).toHaveBeenLastCalledWith({ autoScale: true }); expect(chart.applyOptions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["pointerdown", "wheel"])("releases a temporary fit before a canvas %s gesture", event => {
    render(h(Fixture, { trades: [{ ...trade, takeProfit: 900 }] })); flush();
    fireEvent.click(screen.getByRole("button", { name: "Fit position exits" }));
    expect(series.applyOptions).toHaveBeenLastCalledWith({ autoscaleInfoProvider: expect.any(Function) });
    fireEvent(screen.getByTestId("canvas"), new Event(event));
    expect(series.applyOptions).toHaveBeenLastCalledWith({ autoscaleInfoProvider: undefined });
  });
  it("still opens the exact-price editor when the entry itself is outside the chart", () => {
    vi.spyOn(series, "priceToCoordinate").mockReturnValue(null as any);
    render(h(Fixture)); flush(); fireEvent.click(screen.getByRole("button", { name: "Manage Buy position" }));
    expect(screen.getByRole("dialog", { name: "Edit position protection" })).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("focused trade inspection", () => {
  it("shows closed trade stops read-only and offers All trades", () => {
    const showAll = vi.fn();
    render(h(Fixture, { trades: [{ ...trade, status: "CLOSED", expiryTs: 50, stopLoss: 90, takeProfit: 110 }], focusedTradeId: trade.id, onShowAllTrades: showAll })); flush();
    expect(screen.getByRole("button", {name:"Select Buy ₹100.00 position"})).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove SL" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit position protection" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All trades" }));
    expect(showAll).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it("restores every native entry and exit after leaving the selected trade", () => {
    const a = {...trade, stopLoss: 90, takeProfit: 120};
    const b = {...second, stopLoss: 130, takeProfit: 80};
    const ui = render(h(Fixture, {trades:[a], focusedTradeId:a.id})); flush();
    expect(lines.filter(l => l.options.price === 130)).toHaveLength(0);
    ui.rerender(h(Fixture, {trades:[a,b]})); flush();
    expect(lines.some(l => l.options.price === 130)).toBe(true);
    expect(lines.some(l => l.options.price === 80)).toBe(true);
  });
});

describe("drag-first protection regression checks", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([390,1456])("allows dragging at %ipx without opening numeric input; confirms outside the chart", width => {
    resize(width);
    render(h(Fixture, { trades: [{...trade, takeProfit:110, stopLoss:90}] })); flush();
    const handle = screen.getByRole("button", {name:"Drag TP level"});
    fireEvent.pointerDown(handle,{clientY:280,pointerId:1});
    fireEvent.pointerMove(handle,{clientY:270,pointerId:1}); flush();
    expect(screen.getByRole("button",{name:"TP at 115.00"})).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.pointerUp(handle,{clientY:270,pointerId:1}); flush();
    const confirm = screen.getByRole("button",{name:"Confirm"});
    expect(screen.getByTestId("chart-parent").contains(confirm)).toBe(false);
    expect(screen.getByTestId("actions-dock").contains(confirm)).toBe(true);
  });
  it("keeps one-pixel price changes stable when scale conversion changes mid-gesture", () => {
    render(h(Fixture,{trades:[{...trade,takeProfit:110}]})); flush();
    const handle = screen.getByRole("button",{name:"Drag TP level"});
    fireEvent.pointerDown(handle,{clientY:280,pointerId:1});
    fireEvent.pointerMove(handle,{clientY:270,pointerId:1}); flush();
    vi.spyOn(series,"coordinateToPrice").mockImplementation(y=>5000-y*100);
    fireEvent.pointerMove(handle,{clientY:269,pointerId:1}); flush();
    expect(screen.getByRole("button",{name:"TP at 115.50"})).toBeTruthy();
    fireEvent.pointerUp(handle,{clientY:269,pointerId:1});
  });
  it("anchors a pre-existing offscreen exit to its actual price, not the floating badge", () => {
    render(h(Fixture,{trades:[{...trade,takeProfit:900}]})); flush();
    const handle = screen.getByRole("button",{name:"Drag TP level"});
    fireEvent.pointerDown(handle,{clientY:20,pointerId:1});
    fireEvent.pointerMove(handle,{clientY:16,pointerId:1}); flush();
    expect(screen.getByRole("button",{name:"TP at 902.00 outside chart"})).toBeTruthy();
    expect(scale.setVisibleRange).toHaveBeenCalledWith(expect.objectContaining({to:expect.any(Number)}));
    expect(screen.getByRole("button",{name:"TP at 902.00 outside chart"}).textContent).toContain("₹");
    fireEvent.pointerCancel(handle,{pointerId:1});
  });
  it("sends only the dragged exit and retains the other trade's saved stops", async () => {
    render(h(Fixture,{trades:[{...trade,takeProfit:110,stopLoss:90}, {...second,stopLoss:120}]})); flush();
    const handle = screen.getByRole("button",{name:"Drag TP level"});
    fireEvent.pointerDown(handle,{clientY:280,pointerId:1});
    fireEvent.pointerMove(handle,{clientY:270,pointerId:1});
    fireEvent.pointerUp(handle,{clientY:270,pointerId:1}); flush();
    vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({trade:{...trade,takeProfit:115,stopLoss:90}})} as Response);
    fireEvent.click(screen.getByRole("button",{name:"Confirm"})); await settle();
    expect(requestBody()).toEqual({takeProfit:115});
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/cfd/trades/one");
  });
});

it("extends the range gradually while holding an exit at an edge, then stops on release", () => {
  render(h(Fixture,{trades:[{...trade,takeProfit:110}]})); flush();
  const handle = screen.getByRole("button",{name:"Drag TP level"});
  fireEvent.pointerDown(handle,{clientY:280,pointerId:1});
  fireEvent.pointerMove(handle,{clientY:10,pointerId:1}); flush();
  expect(screen.getByRole("button",{name:"TP at 245.00 outside chart"})).toBeTruthy();
  act(()=>{const pending=frames;frames=[];pending.forEach(f=>f(1000));});
  expect(screen.getByRole("button",{name:"TP at 245.96 outside chart"})).toBeTruthy();
  act(()=>{const pending=frames;frames=[];pending.forEach(f=>f(1016));});
  expect(screen.getByRole("button",{name:"TP at 246.44 outside chart"})).toBeTruthy();
  fireEvent.pointerUp(handle,{clientY:10,pointerId:1});
  act(()=>{const pending=frames;frames=[];pending.forEach(f=>f(5000));});
  expect(screen.getByRole("button",{name:"TP at 246.44 outside chart"})).toBeTruthy();
});
