import { Worker } from "node:worker_threads";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { PriceFeed, Quote } from "./types";

/** Parse decoded FYERS full-mode index updates (type `if`). Index frames may
 * omit exchange time; in that case ts is receipt time, NOT verified source age. */
export function parseFyersQuote(
  raw: unknown,
  bySymbol: Record<string, string>,
  receivedAt = Date.now(),
): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "if" || typeof msg.symbol !== "string" ||
      (msg.s !== undefined && msg.s !== "ok")) return null;
  const symbol = bySymbol[msg.symbol];
  if (!symbol || (typeof msg.ltp !== "number" && typeof msg.ltp !== "string")) return null;
  const price = Number(msg.ltp);
  if (!Number.isFinite(price) || price <= 0) return null;
  const sourceTime = Number(msg.exch_feed_time);
  const ts = Number.isFinite(sourceTime) && sourceTime > 0
    ? Math.floor(sourceTime > 1e12 ? sourceTime / 1000 : sourceTime)
    : Math.floor(receivedAt / 1000);
  return { symbol, price, ts };
}

export type FyersSocketEvent =
  | { type: "connect" | "close" | "error" }
  | { type: "message"; data: unknown };
export interface FyersConnection { close(): Promise<void> }
export type FyersConnector = (
  authorization: string, symbols: string[], onEvent: (event: FyersSocketEvent) => void,
) => FyersConnection;

/** SDK lifecycle isolation avoids its global singleton reusing an expired token. */
export const connectFyersSocket: FyersConnector = (authorization, symbols, onEvent) => {
  const worker = new Worker(new URL("./fyers-worker.cjs", import.meta.url), {
    workerData: { authorization, symbols },
    // Do not inherit tsx's loader into this plain CommonJS SDK worker.
    execArgv: [],
  });
  worker.on("message", onEvent);
  worker.on("error", () => onEvent({ type: "error" }));
  worker.on("exit", () => onEvent({ type: "close" }));
  return { async close() { await worker.terminate(); } };
};

export interface FyersFeedOptions {
  appId: string;
  /** Internal symbol -> FYERS symbol. */
  mapping: Record<string, string>;
  /** Token checks only, NOT quote polling. */
  tokenCheckMs?: number;
  connectTimeoutMs?: number;
  getToken?: () => Promise<string | null>;
  connectSocket?: FyersConnector;
}

async function readStoredToken(): Promise<string | null> {
  const row = await prisma.integrationToken.findUnique({ where: { provider: "fyers" } });
  return row && row.expiresAt.getTime() > Date.now() ? row.accessToken : null;
}

/** One streaming connection for all mapped indices. Every new connection
 * subscribes afresh. DB token checks allow authorization after startup and daily
 * rotation without restarting the engine. Existing engine fallback is unchanged. */
export function createFyersFeed(opts: FyersFeedOptions): PriceFeed {
  const getToken = opts.getToken ?? readStoredToken;
  const connectSocket = opts.connectSocket ?? connectFyersSocket;
  const symbols = Object.values(opts.mapping);
  const bySymbol = Object.fromEntries(Object.entries(opts.mapping).map(([s, f]) => [f, s]));
  let running = false;
  let generation = 0;
  let connection: FyersConnection | null = null;
  let currentToken: string | null = null;
  let checkTimer: NodeJS.Timeout | undefined;
  let connectTimer: NodeJS.Timeout | undefined;
  let checking: Promise<void> | null = null;
  let failures = 0;
  let retryAt = 0;
  let onQuote: ((q: Quote) => void) | null = null;

  async function disconnect() {
    generation++;
    clearTimeout(connectTimer);
    const old = connection;
    connection = null;
    if (old) await old.close();
  }

  function failed(session: number) {
    if (!running || session !== generation) return;
    retryAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(failures++, 5));
    logger.warn({ evt: "engine.feed_gap", feed: "fyers", retryInMs: retryAt - Date.now() },
      "FYERS stream disconnected; reconnect scheduled");
    void disconnect();
  }

  async function reconcile() {
    const beforeRead = generation;
    let token: string | null;
    try { token = await getToken(); }
    catch {
      logger.warn({ evt: "fyers.token_read_failed" }, "could not read FYERS token");
      token = null;
    }
    if (!running || beforeRead !== generation) return;
    if (token !== currentToken) {
      await disconnect();
      currentToken = token;
      failures = 0;
      retryAt = 0;
    }
    if (!running || !token || connection || Date.now() < retryAt || symbols.length === 0) return;
    const session = ++generation;
    connectTimer = setTimeout(() => failed(session), opts.connectTimeoutMs ?? 20_000);
    connectTimer.unref?.();
    try {
      connection = connectSocket(`${opts.appId}:${token}`, symbols, (event) => {
        if (!running || session !== generation) return;
        if (event.type === "connect") {
          clearTimeout(connectTimer);
          logger.info({ evt: "engine.feed_connected", feed: "fyers", symbols }, "FYERS WebSocket connected");
        } else if (event.type === "message") {
          const messages = Array.isArray(event.data) ? event.data : [event.data];
          for (const message of messages) {
            if (message && typeof message === "object" && (message as { s?: string }).s === "error") {
              failed(session);
              return;
            }
            const quote = parseFyersQuote(message, bySymbol);
            if (quote) { failures = 0; onQuote?.(quote); }
          }
        } else failed(session);
      });
    } catch { failed(session); }
  }

  function check(): Promise<void> {
    if (checking) return checking;
    checking = reconcile().finally(() => { checking = null; });
    return checking;
  }

  return {
    async start(callback) {
      if (running) return;
      running = true;
      onQuote = callback;
      checkTimer = setInterval(() => { void check(); }, opts.tokenCheckMs ?? 2_000);
      checkTimer.unref?.();
      await check();
    },
    async stop() {
      running = false;
      onQuote = null;
      clearInterval(checkTimer);
      await disconnect();
      await checking;
      currentToken = null;
    },
  };
}
