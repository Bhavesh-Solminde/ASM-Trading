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
import { parseTrades } from "./trades";

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
  seed: (boot: Bootstrap) => void;
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
});

export const useSocket = create<SocketStore>((set, get) => {
  const onMessage = (m: ServerMessage) =>
    set((s) => {
      const next: Partial<SocketStore> = {
        chart: applyChartMessage(s.chart, m),
        trades: applyTradeMessage(s.trades, m),
      };
      if (m.type === "trade:settled") next.lastSettled = m.trade;
      return next;
    });

  const fetchTicket = async (): Promise<string> => {
    try {
      return (await api("/api/auth/ws-ticket", { method: "POST", schema: Ticket })).ticket;
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
  };

  return {
    ...initial(),
    seed: (boot) =>
      set({
        trades: initialTradeState(
          parseTrades(boot.recentTrades),
          Object.fromEntries(boot.accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }])),
        ),
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
    applyOpenResult: (r) => set((s) => ({ trades: withOpenResult(s.trades, r, s.phase === "authed") })),
  };
});
