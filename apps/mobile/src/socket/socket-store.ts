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
import type { Bootstrap, OpenTradeResult, ServerMessage, Timeframe, TradeView } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { appConfig } from "@/config";
import { unitFromBytes } from "./backoff";
import { EngineSocket, FatalSocketError, type SocketStatus } from "./engine-socket";
import { mergeBootstrap, recoveredAccountsWithStaleBalance, recoveredSettlements } from "./bootstrap-merge";

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
  recovered: [] as readonly TradeView[],
  balanceRefetch: [] as readonly string[],
  balanceAt: {} as Record<string, number>,
});

export const useSocket = create<SocketStore>((set, get) => {
  const onMessage = (m: ServerMessage) =>
    set((s) => {
      const next: Partial<SocketStore> = {
        chart: applyChartMessage(s.chart, m),
        trades: applyTradeMessage(s.trades, m),
      };
      if (m.type === "trade:settled") next.lastSettled = m.trade;
      if (m.type === "balance:update") next.balanceAt = { ...s.balanceAt, [m.accountId]: Date.now() };
      return next;
    });

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
    seed: (boot, requestedAt = Date.now()) =>
      set((s) => {
        const trades = mergeBootstrap(s.trades, s.balanceAt, boot, requestedAt);
        const recovered = recoveredSettlements(s.trades, trades);
        if (recovered.length === 0) return { trades };
        const stale = recoveredAccountsWithStaleBalance(s.trades, recovered, s.balanceAt, boot, requestedAt);
        return stale.length > 0 ? { trades, recovered, balanceRefetch: stale } : { trades, recovered };
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
