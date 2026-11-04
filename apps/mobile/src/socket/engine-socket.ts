import type { ClientMessage, ServerMessage, Timeframe } from "@asm/contracts";
import { backoffDelay } from "./backoff";

export type SocketStatus = { phase: "idle" | "connecting" | "authed" | "closed"; consecutiveFailures: number };

/** A socket that opens but never reaches `authed` within this long is torn down and retried. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Thrown by `fetchTicket` when retrying cannot help (signed out, gated): the socket gives up until start() is called again. */
export class FatalSocketError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "FatalSocketError";
  }
}

interface Deps {
  url: string;
  fetchTicket: () => Promise<string>;
  WebSocketImpl: typeof WebSocket;
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: SocketStatus) => void;
  /** No `Math.random` in this codebase: the caller supplies the jitter source ([0, 1)). */
  random: () => number;
  /** False while the device has no network; reconnects are held (not counted) until `networkRestored()`. */
  isOnline?: () => boolean;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

/**
 * One engine connection: ticket -> auth -> subscribe, with backoff reconnects.
 * Framework-free so it can be unit-tested with a fake WebSocket.
 *
 * Wire protocol (same as the web client): the server sends `ready` on connect, the client replies
 * `{type:"auth", token: <single-use ticket>}`, the server answers `authed` (or `error` + close 1008),
 * and only then does the client subscribe. A reconnect always mints a fresh ticket.
 */
export class EngineSocket {
  private ws: WebSocket | null = null;
  private wanted = false;
  /** Bumped by stop(), so an async connect() that outlived its run can tell it is stale. */
  private run = 0;
  private failures = 0;
  private authed = false;
  /** A ticket request is in flight. */
  private fetching = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private sub: { symbol: string; timeframe: Timeframe } | null = null;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.schedule(0);
  }

  stop(): void {
    this.wanted = false;
    this.run += 1;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    this.fetching = false;
    this.failures = 0;
    ws?.close();
    this.status("idle");
  }

  /**
   * The device came back online (possibly on a different network). Skip any backoff wait and reconnect now
   * with a fresh ticket. An existing connection is recycled too, since after a wifi/cellular switch or a NAT
   * drop it can be dead without ever closing. The recycle is deliberate, so it does not count as a failure.
   */
  networkRestored(): void {
    if (!this.wanted) return;
    this.run += 1; // drops the result of a ticket request still in flight
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    this.fetching = false;
    ws?.close();
    this.schedule(0);
  }

  subscribe(symbol: string, timeframe: Timeframe): void {
    const prev = this.sub;
    this.sub = { symbol, timeframe };
    if (!this.authed) return;
    if (prev && prev.symbol !== symbol) this.send({ type: "unsubscribe", symbol: prev.symbol });
    this.send({ type: "subscribe", symbol, timeframe });
  }

  /** Returns whether the request was actually sent (false: not authed or nothing subscribed). */
  loadOlder(before: number, limit = 200): boolean {
    if (!this.authed || !this.sub) return false;
    return this.send({ type: "candles:loadOlder", symbol: this.sub.symbol, timeframe: this.sub.timeframe, before, limit });
  }

  private isOnline(): boolean {
    return this.deps.isOnline?.() ?? true;
  }

  private schedule(delay: number): void {
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.connect(), delay);
  }

  private clearTimers(): void {
    const clear = this.deps.clearTimer ?? clearTimeout;
    if (this.timer) clear(this.timer);
    if (this.handshake) clear(this.handshake);
    this.timer = null;
    this.handshake = null;
  }

  private async connect(): Promise<void> {
    this.timer = null;
    if (!this.wanted) return;
    if (!this.isOnline()) {
      this.hold();
      return;
    }
    const run = this.run;
    this.status("connecting");
    let ticket: string;
    this.fetching = true;
    try {
      ticket = await this.deps.fetchTicket();
    } catch (err) {
      if (run !== this.run) return;
      this.fetching = false;
      if (err instanceof FatalSocketError) return this.giveUp();
      return this.fail();
    }
    if (run !== this.run) return;
    this.fetching = false;

    const ws = new this.deps.WebSocketImpl(this.deps.url);
    this.ws = ws;
    this.handshake = (this.deps.setTimer ?? setTimeout)(() => {
      this.handshake = null;
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      ws.close();
      this.fail();
    }, HANDSHAKE_TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: ticket } satisfies ClientMessage));
    ws.onmessage = (e: MessageEvent | { data: string }) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "authed") {
        this.authed = true;
        this.failures = 0;
        if (this.handshake) (this.deps.clearTimer ?? clearTimeout)(this.handshake);
        this.handshake = null;
        this.status("authed");
        if (this.sub) this.send({ type: "subscribe", ...this.sub });
      }
      this.deps.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      this.fail();
    };
    ws.onerror = () => ws.close();
  }

  private fail(): void {
    if (this.handshake) (this.deps.clearTimer ?? clearTimeout)(this.handshake);
    this.handshake = null;
    if (!this.wanted) return;
    // Offline drops say nothing about the engine: don't burn a backoff step, just wait for the network.
    if (!this.isOnline()) return this.hold();
    this.failures += 1;
    this.status("closed");
    this.schedule(backoffDelay(this.failures - 1, this.deps.random));
  }

  /** Offline: nothing is scheduled; networkRestored() restarts the loop. */
  private hold(): void {
    this.status("closed");
  }

  private giveUp(): void {
    this.wanted = false;
    this.status("closed");
  }

  private send(m: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private status(phase: SocketStatus["phase"]): void {
    this.deps.onStatus({ phase, consecutiveFailures: this.failures });
  }
}
