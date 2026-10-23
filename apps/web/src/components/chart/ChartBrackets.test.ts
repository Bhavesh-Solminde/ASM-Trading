// @vitest-environment jsdom
import { createElement as h, useRef } from "react";
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
const scale = { options: () => ({ autoScale: true }), applyOptions: vi.fn(), width: () => 65 };
const timeScale = { height: () => 25, subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn() };
const chart = { options: () => ({ handleScroll: true, handleScale: true }), applyOptions: vi.fn(), priceScale: () => scale, timeScale: () => timeScale, subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn() };
const series = { priceToCoordinate: (p: number) => 500 - p * 2, coordinateToPrice: (y: number) => (500 - y) / 2, options: () => ({}), applyOptions: vi.fn(), removePriceLine: vi.fn(), createPriceLine: (options: any) => { const line = { options, applyOptions: vi.fn((next: any) => { line.options = next; }) }; lines.push(line); return line; } };
const market = { getSnapshot: () => ({ quotes: { BTCUSDT: { price: state.price } } }), subscribe: () => () => {} } as any;
function Fixture({ trades = [trade], scope = "demo:BTC", enabled = true }: { trades?: TradeView[]; scope?: string; enabled?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return h("div", { "data-testid": "chart-parent" },
    h("div", { ref: containerRef, "data-testid": "canvas" }),
    h(ChartBrackets, { key: `${scope}:${enabled}`, trades, controlsEnabled: enabled, seriesRef: { current: series } as any, chartRef: { current: chart } as any, containerRef, precision: 2, tickSize: .01, currency: "INR", chartVersion: 1, market }));
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
    expect(chart.applyOptions).toHaveBeenCalledWith({ handleScroll: false, handleScale: false });
    state.now = 200; ui.rerender(h(Fixture, { trades: [trade, second] })); flush();
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true });
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
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ handleScroll: true, handleScale: true }); expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    open(); enableTP(); fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit position protection" }));
    expect((screen.getByRole("spinbutton", { name: "TP price" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "110" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP reward" }), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "TP price" }), { target: { value: "112" } });
    expect((screen.getByRole("spinbutton", { name: "TP reward" }) as HTMLInputElement).value).toBe("11.95");
    expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close protection editor" })); open();
    expect((screen.getByRole("checkbox", { name: "Enable TP" }) as HTMLInputElement).checked).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
});
