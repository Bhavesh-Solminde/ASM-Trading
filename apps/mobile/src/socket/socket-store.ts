import NetInfo from "@react-native-community/netinfo";
import { getRandomBytes } from "expo-crypto";
import { z } from "zod";
import { create } from "zustand";
import {
  applyChartMessage,
  applyTradeMessage,
  canLoadOlder,
  initialChartState,
  initialTradeState,
  withOpenResult,
  type ChartState,
  type TradeState,
} from "@asm/client-core";
import type { Bootstrap, CfdOpenTradeResult, CfdTradeView, OpenTradeResult, ServerMessage, Timeframe, TradeView } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { appConfig } from "@/config";
import { unitFromBytes } from "./backoff";
import { EngineSocket, FatalSocketError, type SocketStatus } from "./engine-socket";
import { mergeBootstrap, recoveredAccountsWithStaleBalance, recoveredSettlements, withFreshTrades } from "./bootstrap-merge";
import { parseTrades } from "./trades";

import { mergeCfd, parseCfd, type CfdBook } from "@/cfd/model";

const Ticket = z.object({ ticket: z.string() });

/**
 * Ticket failures that retrying cannot fix: the session is gone (the api layer is already signing out)
 * or a gate screen (maintenance / blocked / upgrade) now owns navigation and unmounts the tabs.
 */
const FATAL_TICKET_CODES = new Set(["unauthenticated", "maintenance", "blocked", "upgrade"]);

interface SocketStore {
  phase: SocketStatus["phase"];
  consecutiveFailures: number;
  chart: ChartState;
  trades: TradeState;
  lastSettled: TradeView | null;
  cfd: CfdBook;
  cfdCurrency: Record<string, string>;
  cfdGeneration: Record<string, number>;
  cfdRevision: Record<string, number>;
  touchCfdAccount: (accountId: string) => void;
  prepareCfdAccount: (accountId: string, currency: string) => number;
  lastCfdSettled: CfdTradeView | null;
  mergeCfdTrades: (accountId: string, rows: readonly unknown[]) => void;
  applyCfdResult: (r: CfdOpenTradeResult) => void;
  /**
   * Settlements the last bootstrap merge recovered (open here, settled in the response): the socket never
   * delivered them. A new array identity per merge that found any, so subscribers announce each batch once.
   */
  recovered: readonly TradeView[];
  /**
   * Accounts whose recovered settlement kept a newer stored balance instead of the response's (see
   * `mergeBootstrap`): a new array identity per merge that found any, so the watchdog requests ONE follow-up
   * bootstrap per batch. Empty arrays are never published.
   */
  balanceRefetch: readonly string[];
  /** When (epoch ms) the socket last delivered a balance for each account; decides whether a bootstrap is newer. */
  balanceAt: Record<string, number>;
  /**
   * Folds a bootstrap response in, merge-safe: never rolls back socket data that arrived while the request
   * was in flight. `requestedAt` is when the request started (default: now).
   */
  seed: (boot: Bootstrap, requestedAt?: number) => void;
  /**
   * Folds one account's freshly fetched trade list (`GET /api/trades?accountId=`) in, merge-safe like `seed`: a
   * settled version always beats an open one. Rows that are malformed or belong to another account are skipped.
   * Publishes `recovered` like `seed` does, so a recovered settlement is announced once.
   */
  mergeFetchedTrades: (accountId: string, rows: readonly unknown[]) => void;
  start: () => void;
  stop: () => void;
  /** Back to the signed-out state: closes the socket and forgets the previous user's market data and trades. */
  reset: () => void;
  subscribe: (symbol: string, timeframe: Timeframe) => void;
  loadOlder: () => void;
  applyOpenResult: (r: OpenTradeResult) => void;
}

let engine: EngineSocket | null = null;
let unwatchNet: (() => void) | null = null;
/** Optimistic until NetInfo says otherwise. Only `isConnected === false` counts as offline: `isInternetReachable` can be a false negative. */
let online = true;

const random = () => unitFromBytes(getRandomBytes(4));

const initial = () => ({
  phase: "idle" as const,
  consecutiveFailures: 0,
  chart: initialChartState("", "1m"),
  trades: initialTradeState([], {}),
  lastSettled: null,
  cfd: {} as CfdBook,
  cfdCurrency: {} as Record<string, string>,
  cfdGeneration: {} as Record<string, number>,
  cfdRevision: {} as Record<string, number>,
  lastCfdSettled: null,
  recovered: [] as readonly TradeView[],
  balanceRefetch: [] as readonly string[],
  balanceAt: {} as Record<string, number>,
});

export const useSocket = create<SocketStore>((set, get) => {
  const onMessage = (m: ServerMessage) => {
    // Legacy website CFD notifications share the binary channel; native consumes the full cfd:* DTO only.
    if ((m.type === "trade:opened" || m.type === "trade:settled") && m.trade.durationSec != null) return;
    // The socket's JSON is not validated (a cast). A balance that is not a number would poison the store and every
    // figure derived from it, so such a message is ignored; the next bootstrap carries the real balance.
    if (m.type === "balance:update" && !(Number.isFinite(m.realBalance) && Number.isFinite(m.bonusBalance))) return;
    set((s) => {
      const next: Partial<SocketStore> = {
        chart: applyChartMessage(s.chart, m),
        trades: applyTradeMessage(s.trades, m),
      };
      if (m.type === "trade:settled") next.lastSettled = m.trade;
      if (m.type === "cfd:trade:opened" || m.type === "cfd:trade:settled") {
        const [trade] = parseCfd([m.trade]);
        if (trade) {
          next.cfd = mergeCfd(s.cfd, trade.accountId, [trade], "socket");
          next.cfdRevision = { ...s.cfdRevision, [trade.accountId]: (s.cfdRevision[trade.accountId] ?? 0) + 1 };
        }
        if (trade && m.type === "cfd:trade:settled") next.lastCfdSettled = trade;
      }
      if (m.type === "cfd:trade:modified" && [m.stopLoss, m.takeProfit].every(level => level === null || typeof level === "number" && Number.isFinite(level) && level > 0)) {
        const revision = { ...s.cfdRevision };
        for (const [id, rows] of Object.entries(s.cfd)) if (rows.some(t => t.id === m.tradeId)) revision[id] = (revision[id] ?? 0) + 1;
        next.cfdRevision = revision;
        next.cfd = Object.fromEntries(Object.entries(s.cfd).map(([id, rows]) => [id, rows.map(t => t.id === m.tradeId ? { ...t, stopLoss: m.stopLoss, takeProfit: m.takeProfit } : t)]));
      }
      if (m.type === "balance:update") next.balanceAt = { ...s.balanceAt, [m.accountId]: Date.now() };
      return next;
    });
  };

  const fetchTicket = async (): Promise<string> => {
    try {
      return (await api("/api/auth/ws-ticket", { method: "POST", schema: Ticket, silentRateLimit: true })).ticket;
    } catch (err) {
      if (err instanceof ApiError && err.code !== null && FATAL_TICKET_CODES.has(err.code)) {
        throw new FatalSocketError(err.code);
      }
      throw err;
    }
  };

  const ensure = () =>
    (engine ??= new EngineSocket({
      url: appConfig().wsUrl,
      fetchTicket,
      WebSocketImpl: WebSocket,
      onMessage,
      onStatus: (st) => set({ phase: st.phase, consecutiveFailures: st.consecutiveFailures }),
      isOnline: () => online,
      random,
    }));

  const watchNet = () => {
    unwatchNet ??= NetInfo.addEventListener((state) => {
      const was = online;
      online = state.isConnected !== false;
      if (online && !was) engine?.networkRestored();
    });
  };
  const unwatch = () => {
    unwatchNet?.();
    unwatchNet = null;
    // Forget the last reading: the next start() re-reads it from NetInfo rather than trusting a stale value.
    online = true;
  };

  return {
    ...initial(),
    touchCfdAccount: accountId => set(s => ({ cfdRevision: { ...s.cfdRevision, [accountId]: (s.cfdRevision[accountId] ?? 0) + 1 } })),
    prepareCfdAccount: (accountId, currency) => {
      const state = get();
      if (state.cfdCurrency[accountId] === currency) return state.cfdGeneration[accountId] ?? 0;
      const generation = (state.cfdGeneration[accountId] ?? 0) + 1;
      set({ cfd: { ...state.cfd, [accountId]: [] }, cfdCurrency: { ...state.cfdCurrency, [accountId]: currency }, cfdGeneration: { ...state.cfdGeneration, [accountId]: generation } });
      return generation;
    },
    mergeCfdTrades: (accountId, rows) => set(s => {
      const parsed = parseCfd(rows);
      const recovered = parsed.find(t => t.status === "CLOSED" && s.cfd[accountId]?.some(old => old.id === t.id && old.status === "OPEN"));
      return { cfd: mergeCfd(s.cfd, accountId, parsed), ...(recovered ? { lastCfdSettled: recovered } : {}) };
    }),
    applyCfdResult: r => set(s => ({
      cfd: mergeCfd(s.cfd, r.trade.accountId, [r.trade]),
      ...(s.phase === "authed" ? {} : {
        trades: { ...s.trades, balances: { ...s.trades.balances, [r.trade.accountId]: r.balances } },
        balanceAt: { ...s.balanceAt, [r.trade.accountId]: Date.now() },
      }),
    })),
    seed: (boot, requestedAt = Date.now()) =>
      set((s) => {
        const trades = mergeBootstrap(s.trades, s.balanceAt, boot, requestedAt);
        const recovered = recoveredSettlements(s.trades, trades);
        if (recovered.length === 0) return { trades };
        const stale = recoveredAccountsWithStaleBalance(s.trades, recovered, s.balanceAt, boot, requestedAt);
        return stale.length > 0 ? { trades, recovered, balanceRefetch: stale } : { trades, recovered };
      }),
    mergeFetchedTrades: (accountId, rows) =>
      set((s) => {
        const trades = withFreshTrades(
          s.trades,
          accountId,
          parseTrades(rows).filter((t) => t.accountId === accountId),
        );
        // Same as `seed`: a trade held open here and settled in the list is a settlement the socket never delivered
        // (a non-default account's bootstrap carries no trades, so this is its only recovery path). It touches no
        // balance, so there is no follow-up to request.
        const recovered = recoveredSettlements(s.trades, trades);
        return recovered.length === 0 ? { trades } : { trades, recovered };
      }),
    start: () => {
      watchNet();
      ensure().start();
    },
    stop: () => {
      unwatch();
      engine?.stop();
    },
    reset: () => {
      unwatch();
      engine?.stop();
      engine = null;
      set(initial());
    },
    subscribe: (symbol, timeframe) => {
      set({ chart: initialChartState(symbol, timeframe) });
      ensure().subscribe(symbol, timeframe);
    },
    loadOlder: () => {
      const { chart } = get();
      const first = chart.candles[0];
      if (!first || !canLoadOlder(chart)) return;
      // Only mark the request in flight if it was actually sent, or loadingOlder would stick while offline.
      if (ensure().loadOlder(first.openTs)) set({ chart: { ...chart, loadingOlder: true } });
    },
    applyOpenResult: (r) =>
      set((s) => {
        const socketLive = s.phase === "authed";
        return {
          trades: withOpenResult(s.trades, r, socketLive),
          // The HTTP balances are only applied while the socket is down; stamp them like a socket update so a
          // bootstrap request that started before this open cannot overwrite them with an older figure.
          ...(socketLive ? {} : { balanceAt: { ...s.balanceAt, [r.trade.accountId]: Date.now() } }),
        };
      }),
  };
});
