"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { BalancesDto, OpenTradeResult, ServerMessage, Timeframe, TradeView } from "@asm/contracts";
import { useEngineSocket, type SocketStatus } from "@/components/chart/useEngineSocket";
import { playSettled } from "@/lib/sound";
import {
  applyTradeMessage,
  initialTradeState,
  withFetchedTrades,
  withOpenResult,
  type TradeState,
} from "@/components/trade/trade-state";
import { MarketStore, useMarket } from "./market-store";
import type { Quote } from "./quotes";

export interface PlatformAsset {
  symbol: string;
  displayName: string;
  payoutPct: number;
  precision: number;
}

export interface AccountView {
  id: string;
  type: "LIVE" | "DEMO";
  currency: string;
}

type Action =
  | { kind: "message"; message: ServerMessage }
  | { kind: "opened"; result: OpenTradeResult; socketLive: boolean }
  | { kind: "fetched"; accountId: string; trades: TradeView[] };

function reducer(state: TradeState, action: Action): TradeState {
  switch (action.kind) {
    case "message":
      return applyTradeMessage(state, action.message);
    case "opened":
      return withOpenResult(state, action.result, action.socketLive);
    case "fetched":
      return withFetchedTrades(state, action.accountId, action.trades);
  }
}

/** The only messages that change React state; everything tick-rate goes to the market store. */
const TRADE_MESSAGES = new Set<ServerMessage["type"]>(["trade:opened", "trade:settled", "balance:update"]);

interface PlatformContextValue {
  assets: PlatformAsset[];
  accounts: AccountView[];
  activeAccount: AccountView | undefined;
  setActiveAccountId: (id: string) => void;
  balances: Readonly<Record<string, BalancesDto>>;
  tradesByAccount: TradeState["tradesByAccount"];
  market: MarketStore;
  status: SocketStatus;
  /** Whether this user may switch to and trade the real-money LIVE account. */
  liveAccess: boolean;
  chartSymbol: string;
  selectChartSymbol: (symbol: string) => void;
  timeframe: Timeframe;
  selectTimeframe: (timeframe: Timeframe) => void;
  recordOpened: (result: OpenTradeResult) => void;
  /** Distraction-free phone trading view: chart + ticket only, chrome hidden. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
  /** The most recent settlement on the active account, for the in-chart result popup. */
  settlement: { trade: TradeView; at: number } | null;
  clearSettlement: () => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/**
 * Owns everything the shell and the trade screen share: the one engine
 * socket, the active account, balances and trades. Living in the platform
 * layout keeps the top bar balance and the tape live on every page.
 *
 * Prices are deliberately not in this context — see MarketStore.
 */
export function PlatformProvider({
  assets,
  accounts,
  initialBalances,
  initialTrades,
  defaultSymbol,
  liveAccess,
  children,
}: {
  assets: PlatformAsset[];
  accounts: AccountView[];
  initialBalances: Record<string, BalancesDto>;
  initialTrades: TradeView[];
  defaultSymbol: string;
  liveAccess: boolean;
  children: React.ReactNode;
}) {
  const [activeAccountId, setActiveAccountId] = useState(
    accounts.find((a) => a.type === "DEMO")?.id ?? accounts[0]?.id ?? "",
  );
  const [chartSymbol, setChartSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [focusMode, setFocusMode] = useState(false);
  const [settlement, setSettlement] = useState<{ trade: TradeView; at: number } | null>(null);
  const clearSettlement = useCallback(() => setSettlement(null), []);
  const [market] = useState(() => new MarketStore(defaultSymbol, "1m", assets));
  const [trades, dispatch] = useReducer(
    reducer,
    { initialTrades, initialBalances },
    (init) => initialTradeState(init.initialTrades, init.initialBalances),
  );

  // Always holds the latest active account without going in onMessage's deps
  // below — adding it there would tear down and rebuild the socket on every
  // account switch.
  const activeAccountIdRef = useRef(activeAccountId);
  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  const watch = useMemo(() => assets.map((a) => a.symbol), [assets]);
  const onMessage = useCallback(
    (message: ServerMessage) => {
      market.apply(message);
      if (TRADE_MESSAGES.has(message.type)) dispatch({ kind: "message", message });
      if (message.type === "trade:settled" && message.trade.accountId === activeAccountIdRef.current) {
        playSettled(message.trade.status);
        setSettlement({ trade: message.trade, at: Date.now() });
      }
    },
    [market],
  );
  const { status, send } = useEngineSocket({ symbol: chartSymbol, timeframe, watch, onMessage });

  // Let the market store reach the socket for scroll-left history backfill.
  useEffect(() => {
    market.setSender(send);
    return () => market.setSender(null);
  }, [market, send]);

  const selectChartSymbol = useCallback(
    (symbol: string) => {
      market.selectSymbol(symbol);
      setChartSymbol(symbol);
    },
    [market],
  );

  const selectTimeframe = useCallback(
    (tf: Timeframe) => {
      market.selectTimeframe(tf);
      setTimeframe(tf);
    },
    [market],
  );

  // The layout rendered history for the default account only; fetch on switch.
  useEffect(() => {
    if (!activeAccountId) return;
    const controller = new AbortController();
    void fetch(`/api/trades?accountId=${encodeURIComponent(activeAccountId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ trades: TradeView[] }>) : null))
      .then((body) => {
        if (body) dispatch({ kind: "fetched", accountId: activeAccountId, trades: body.trades });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [activeAccountId]);

  const recordOpened = useCallback(
    (result: OpenTradeResult) => dispatch({ kind: "opened", result, socketLive: status === "open" }),
    [status],
  );

  const value = useMemo<PlatformContextValue>(
    () => ({
      assets,
      accounts,
      activeAccount: accounts.find((a) => a.id === activeAccountId),
      setActiveAccountId,
      balances: trades.balances,
      tradesByAccount: trades.tradesByAccount,
      market,
      status,
      liveAccess,
      chartSymbol,
      selectChartSymbol,
      timeframe,
      selectTimeframe,
      recordOpened,
      focusMode,
      setFocusMode,
      settlement,
      clearSettlement,
    }),
    [
      assets,
      accounts,
      activeAccountId,
      trades,
      market,
      status,
      liveAccess,
      chartSymbol,
      selectChartSymbol,
      timeframe,
      selectTimeframe,
      recordOpened,
      focusMode,
      settlement,
      clearSettlement,
    ],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error("usePlatform must be used inside <PlatformProvider>");
  return value;
}

/** One symbol's live quote; re-renders only when that symbol changes. */
export function useQuote(symbol: string): Quote | undefined {
  const { market } = usePlatform();
  return useMarket(market, (s) => s.quotes[symbol]);
}
