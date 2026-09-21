"use client";

import { useSyncExternalStore } from "react";
import type { ClientMessage, ServerMessage, Timeframe } from "@asm/contracts";
import {
  applyChartMessage,
  canLoadOlder,
  initialChartState,
  type ChartState,
} from "@/components/chart/engine-state";
import { applyQuoteMessage, initialQuotes, type Quotes } from "./quotes";

/** How many candles to pull per scroll-left backfill (server clamps to ≤500). */
const LOAD_OLDER_LIMIT = 200;

export interface MarketSnapshot {
  readonly chart: ChartState;
  readonly quotes: Quotes;
}

/**
 * Tick-rate market data, kept outside React state.
 *
 * The engine sends ten ticks a second per watched symbol. Holding them in
 * context re-rendered the whole platform on every tick. Instead, components
 * subscribe to just the slice they draw (`useMarket`), and the chart skips
 * React entirely and writes to its canvas from `subscribe`.
 *
 * The snapshot updates immediately; listeners are notified at most once per
 * animation frame, so a burst of ticks costs one render and none while the
 * tab is hidden.
 */
export class MarketStore {
  private snapshot: MarketSnapshot;
  private readonly listeners = new Set<() => void>();
  private frame = 0;
  /** Sends a client message on the live socket; set by the socket owner. */
  private sender: ((message: ClientMessage) => void) | null = null;

  constructor(symbol: string, timeframe: Timeframe, assets: readonly { symbol: string; payoutPct: number }[]) {
    this.snapshot = { chart: initialChartState(symbol, timeframe), quotes: initialQuotes(assets) };
  }

  readonly getSnapshot = (): MarketSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  apply(message: ServerMessage): void {
    const chart = applyChartMessage(this.snapshot.chart, message);
    const quotes = applyQuoteMessage(this.snapshot.quotes, message);
    if (chart === this.snapshot.chart && quotes === this.snapshot.quotes) return;
    this.snapshot = { chart, quotes };
    this.schedule();
  }

  /** Points the chart at another symbol; ticks still in flight for the old one are ignored. */
  selectSymbol(symbol: string): void {
    if (this.snapshot.chart.symbol === symbol) return;
    this.snapshot = { ...this.snapshot, chart: initialChartState(symbol, this.snapshot.chart.timeframe) };
    this.schedule();
  }

  /** Wires the store to the live socket so `loadOlder` can reach the engine. */
  setSender(sender: ((message: ClientMessage) => void) | null): void {
    this.sender = sender;
  }

  /**
   * Requests candles older than the earliest one held, for scroll-left history.
   * A no-op while a request is in flight, once history is exhausted, or before
   * the socket is wired — the chart may call this on every scroll frame.
   */
  loadOlder(): void {
    const chart = this.snapshot.chart;
    if (!this.sender || !canLoadOlder(chart)) return;
    const oldest = chart.candles[0];
    if (!oldest) return;
    this.snapshot = { ...this.snapshot, chart: { ...chart, loadingOlder: true } };
    this.sender({
      type: "candles:loadOlder",
      symbol: chart.symbol,
      timeframe: chart.timeframe,
      before: oldest.openTs,
      limit: LOAD_OLDER_LIMIT,
    });
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      for (const listener of this.listeners) listener();
    });
  }
}

/**
 * Subscribes to one slice of market data. The selector must return a
 * primitive or an object already held in the snapshot, so unchanged slices
 * compare equal and skip the render.
 */
export function useMarket<T>(store: MarketStore, selector: (snapshot: MarketSnapshot) => T): T {
  const read = () => selector(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, read, read);
}
