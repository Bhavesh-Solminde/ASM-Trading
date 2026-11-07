"use client";

import { useSyncExternalStore } from "react";
import type { ClientMessage, ServerMessage, Timeframe,OtcMarketMessage,OtcBotsMessage } from "@asm/contracts";
import {
  applyChartMessage,
  canLoadOlder,
  initialChartState,
  type ChartState,
} from "@/components/chart/engine-state";
import { applyQuoteMessage, initialQuotes, type Quotes } from "./quotes";
import { beginChartSwitch } from "@/components/chart/diagnostics";

/** How many candles to pull per scroll-left backfill (server clamps to ≤500). */
const LOAD_OLDER_LIMIT = 200;

export interface MarketSnapshot {
  readonly otc:OtcMarketMessage|null;
  readonly bots:OtcBotsMessage["rows"];
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
  private displayedQuote: { symbol:string;generation:string;price:number;token:string } | null = null;
  private snapshot: MarketSnapshot;
  private readonly listeners = new Set<() => void>();
  private frame = 0;
  private cache=new Map<string,ChartState>();
  private workerGeneration:string|null=null;
  /** Sends a client message on the live socket; set by the socket owner. */
  private sender: ((message: ClientMessage) => void) | null = null;

  constructor(symbol: string, timeframe: Timeframe, assets: readonly { symbol: string; payoutPct: number }[]) {
    this.snapshot = { chart: initialChartState(symbol, timeframe), quotes: initialQuotes(assets),otc:null,bots:[] };
  }

  readonly getSnapshot = (): MarketSnapshot => this.snapshot;

  /** Called after the visible price readout commits its text to the DOM. */
  markDisplayedQuote(symbol:string, price:number|null, precision:number, quote:OtcMarketMessage["displayQuote"]) {
    const state=this.snapshot.chart;
    if (state.symbol!==symbol) return;
    if (!state.generation || !quote || price===null || quote.token!==this.snapshot.otc?.displayQuote?.token
      || Number(price.toFixed(precision))!==quote.price) {this.displayedQuote=null;return;}
    this.displayedQuote={symbol,generation:state.generation,price:quote.price,token:quote.token};
  }

  getDisplayedQuote(symbol:string) {
    const quote=this.displayedQuote,state=this.snapshot.chart;
    return quote?.symbol===symbol && state.symbol===symbol && quote.generation===state.generation ? quote : null;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  apply(message: ServerMessage): void {
    if(message.type==="ready"&&message.model==="OTC_FIXED"&&message.generation){
      const previous=this.workerGeneration??this.snapshot.chart.generation;this.workerGeneration=message.generation;
      if(previous&&message.generation!==previous){this.displayedQuote=null;this.cache.clear();this.snapshot={...this.snapshot,chart:initialChartState(this.snapshot.chart.symbol,this.snapshot.chart.timeframe),otc:null,bots:[]};this.schedule();return;}
    }
    const chart = applyChartMessage(this.snapshot.chart, message);
    if(message.type==="otc:market"&&chart.generation===message.generation)this.workerGeneration=message.generation;
    const quotes = applyQuoteMessage(this.snapshot.quotes, message);
    const otc=message.type==="otc:market"&&message.symbol===chart.symbol&&message.timeframe===chart.timeframe&&chart.generation===message.generation&&chart.sequence===message.sequence?message:this.snapshot.otc;
    const bots=message.type==="otc:bots"?message.rows:this.snapshot.bots;
    if (chart === this.snapshot.chart && quotes === this.snapshot.quotes&&otc===this.snapshot.otc&&bots===this.snapshot.bots) return;
    this.snapshot = { chart, quotes,otc,bots };
    this.schedule();
  }

  /** Points the chart at another symbol; ticks still in flight for the old one are ignored. */
  selectSymbol(symbol: string): void {
    if (this.snapshot.chart.symbol === symbol) return;
    this.displayedQuote=null;
    this.cacheCurrent();
    beginChartSwitch(`${symbol}:${this.snapshot.chart.timeframe}`,this.cache.has(`${symbol}:${this.snapshot.chart.timeframe}`));
    this.snapshot = { ...this.snapshot,otc:null, chart:this.cache.get(`${symbol}:${this.snapshot.chart.timeframe}`)??initialChartState(symbol, this.snapshot.chart.timeframe) };
    this.schedule();
  }

  /** Switches the chart timeframe; resets candle state so fresh history loads. */
  selectTimeframe(timeframe: Timeframe): void {
    if (this.snapshot.chart.timeframe === timeframe) return;
    this.displayedQuote=null;
    this.cacheCurrent();
    beginChartSwitch(`${this.snapshot.chart.symbol}:${timeframe}`,this.cache.has(`${this.snapshot.chart.symbol}:${timeframe}`));
    this.snapshot = { ...this.snapshot,otc:null, chart:this.cache.get(`${this.snapshot.chart.symbol}:${timeframe}`)??initialChartState(this.snapshot.chart.symbol, timeframe) };
    this.schedule();
  }

  /** Wires the store to the live socket so `loadOlder` can reach the engine. */
  setSender(sender: ((message: ClientMessage) => void) | null): void {
    this.sender = sender;
  }
  private cacheCurrent(){const chart=this.snapshot.chart,key=`${chart.symbol}:${chart.timeframe}`;this.cache.delete(key);this.cache.set(key,chart);if(this.cache.size>6)this.cache.delete(this.cache.keys().next().value!);}

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
