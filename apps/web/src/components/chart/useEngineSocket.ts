"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, Timeframe } from "@asm/contracts";

export type SocketStatus = "connecting" | "open" | "closed" | "unauthorised";

const WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://localhost:4001";
const MAX_BACKOFF_MS = 15_000;

type TicketResult =
  | { kind: "ticket"; ticket: string }
  | { kind: "unauthorised" }
  | { kind: "unavailable" };

/**
 * Only a 401 means the session is gone. A network error, a 429 or a 5xx is
 * transient, and the caller retries it with backoff rather than giving up.
 */
async function fetchTicket(): Promise<TicketResult> {
  const res = await fetch("/api/auth/ws-ticket", { method: "POST", cache: "no-store" }).catch(
    () => null,
  );
  if (res?.status === 401) return { kind: "unauthorised" };
  if (!res || !res.ok) return { kind: "unavailable" };
  const body = (await res.json().catch(() => ({}))) as { ticket?: string };
  return body.ticket ? { kind: "ticket", ticket: body.ticket } : { kind: "unavailable" };
}

/**
 * The page's single connection to the engine.
 *
 * The socket's lifetime is independent of the symbol: switching assets sends
 * unsubscribe/subscribe on the open socket instead of reconnecting. Every
 * server message is handed to `onMessage`; the hook holds no market data
 * itself, so a tick never re-renders the component that owns the socket.
 */
export function useEngineSocket(opts: {
  symbol: string;
  timeframe: Timeframe;
  /** Symbols kept subscribed for as long as the socket is open (the ticker tape). */
  watch?: readonly string[];
  onMessage?: (message: ServerMessage) => void;
}): { status: SocketStatus; send: (message: ClientMessage) => void } {
  const [status, setStatus] = useState<SocketStatus>("connecting");

  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(opts.onMessage);
  const symbolRef = useRef(opts.symbol);
  const watchKey = (opts.watch ?? []).join(",");
  const watchRef = useRef<readonly string[]>(opts.watch ?? []);

  // Always call the latest callback without reconnecting when it changes.
  useEffect(() => {
    onMessageRef.current = opts.onMessage;
    symbolRef.current = opts.symbol;
    watchRef.current = opts.watch ?? [];
  });

  useEffect(() => {
    let closedByUs = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      attempt += 1;
      // Jitter from crypto rather than Math.random, which the lint gate bans.
      const jitter = crypto.getRandomValues(new Uint32Array(1))[0]! % 400;
      reconnectTimer = setTimeout(() => void connect(), Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt + jitter));
    };

    const connect = async (): Promise<void> => {
      setStatus("connecting");
      const result = await fetchTicket();
      if (closedByUs) return;
      if (result.kind === "unauthorised") {
        setStatus("unauthorised");
        return;
      }
      if (result.kind === "unavailable") {
        setStatus("closed");
        scheduleReconnect();
        return;
      }
      const { ticket } = result;

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: ticket }));

      socket.onmessage = (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === "authed") {
          attempt = 0;
          setStatus("open");
        }
        onMessageRef.current?.(message);
      };

      socket.onclose = () => {
        socketRef.current = null;
        if (closedByUs) return;
        // A 1008 "Unauthorised" close also covers a ticket that merely expired
        // before redemption. Reconnect with a fresh ticket; the ticket route's
        // 401 is the only authoritative "session gone" signal.
        setStatus("closed");
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  // Subscription follows the symbol. Re-runs on every (re)authentication, so a
  // reconnect resubscribes and receives fresh history.
  useEffect(() => {
    const socket = socketRef.current;
    if (status !== "open" || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: "subscribe", symbol: opts.symbol, timeframe: opts.timeframe }));
    return () => {
      // A watched symbol stays subscribed after the chart moves off it.
      if (socket.readyState === WebSocket.OPEN && !watchRef.current.includes(opts.symbol)) {
        socket.send(JSON.stringify({ type: "unsubscribe", symbol: opts.symbol }));
      }
    };
  }, [opts.symbol, opts.timeframe, status]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!watchKey || status !== "open" || !socket || socket.readyState !== WebSocket.OPEN) return;

    const symbols = watchKey.split(",");
    for (const symbol of symbols) {
      socket.send(JSON.stringify({ type: "subscribe", symbol, timeframe: opts.timeframe }));
    }
    return () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      for (const symbol of symbols) {
        if (symbol === symbolRef.current) continue;
        socket.send(JSON.stringify({ type: "unsubscribe", symbol }));
      }
    };
  }, [watchKey, opts.timeframe, status]);

  // Stable across renders so effects that depend on it (e.g. wiring the market
  // store) don't re-run. Silently drops messages while the socket is not open;
  // the caller retries — a reconnect resubscribes and re-fetches history.
  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  return { status, send };
}
