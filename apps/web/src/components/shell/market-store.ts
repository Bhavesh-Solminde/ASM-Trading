"use client";

import { useSyncExternalStore } from "react";
import type { ServerMessage, Timeframe } from "@asm/contracts";
import { applyChartMessage, initialChartState, type ChartState } from "@/components/chart/engine-state";
import { applyQuoteMessage, initialQuotes, type Quotes } from "./quotes";

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
