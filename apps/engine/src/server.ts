import { WebSocketServer, type WebSocket } from "ws";
import {
  ClientMessageSchema,
  type ServerMessage,
  type Timeframe,
} from "@asm/contracts";
import { prisma } from "@asm/db";
import { childLogger, newCorrelationId, logger } from "@asm/logger";
import type { AssetRegistry } from "./assets/registry";

/** Resolves a one-time ticket to a user id, or null. Injected so tests need no Redis. */
export type Authenticate = (ticket: string) => Promise<string | null>;

interface Client {
  socket: WebSocket;
  userId: string | null;
  subscriptions: Map<string, Timeframe>;
  cid: string;
  messageBudget: number;
  /** Messages from one socket are handled strictly in arrival order. */
  queue: Promise<void>;
}

const MESSAGE_BUDGET_PER_WINDOW = 60;
const BUDGET_WINDOW_MS = 10_000;
const HISTORY_CANDLES = 120;

export class EngineServer {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private budgetTimer: NodeJS.Timeout;
  private readonly listening: Promise<void>;

  constructor(
    private readonly registry: AssetRegistry,
    port: number,
    private readonly authenticate: Authenticate,
  ) {
    this.wss = new WebSocketServer({ port });
    this.listening = new Promise((resolve) => this.wss.once("listening", () => resolve()));
    this.wss.on("connection", (socket) => this.onConnection(socket));

    this.budgetTimer = setInterval(() => {
      for (const client of this.clients) {
        client.messageBudget = MESSAGE_BUDGET_PER_WINDOW;
      }
    }, BUDGET_WINDOW_MS);

    void this.listening.then(() =>
      logger.info({ evt: "engine.ws_listening", port: this.port() }, "websocket server listening"),
    );
  }

  ready(): Promise<void> {
    return this.listening;
  }

  port(): number {
    const address = this.wss.address();
    return typeof address === "object" && address !== null ? address.port : 0;
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = {
      socket,
      userId: null,
      subscriptions: new Map(),
      cid: newCorrelationId(),
      messageBudget: MESSAGE_BUDGET_PER_WINDOW,
      queue: Promise.resolve(),
    };
    this.clients.add(client);

    socket.on("message", (raw) => {
      if (client.messageBudget-- <= 0) {
        childLogger(client.cid).warn(
          { evt: "security.rate_limited", channel: "ws" },
          "message budget exceeded",
        );
        client.socket.close(1008, "Too many messages");
        return;
      }
      client.queue = client.queue
        .then(() => this.onMessage(client, raw.toString()))
        .catch((err: unknown) => {
          childLogger(client.cid).error(
            { evt: "engine.ws_handler_failed", reason: err instanceof Error ? err.message : "unknown" },
            "ws message handler failed",
          );
          // Without a close the client would wait on an open socket forever
          // (e.g. Redis down during auth). 1011 is not "Unauthorised", so the
          // browser backs off and retries with a fresh ticket.
          client.socket.close(1011, "Internal error");
        });
    });
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));

    this.send(client, { type: "ready", serverTs: Date.now() });
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    const log = childLogger(client.cid);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.send(client, { type: "error", message: "Malformed message." });
      return;
    }

    const parsed = ClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      log.warn(
        { evt: "security.validation_rejected", channel: "ws" },
        "rejected ws message",
      );
      this.send(client, { type: "error", message: "Unrecognised message." });
      return;
    }

    const message = parsed.data;

    if (message.type === "auth") {
      if (client.userId) {
        this.send(client, { type: "error", message: "Already authenticated." });
        return;
      }

      const userId = await this.authenticate(message.token);
      if (!userId) {
        this.send(client, { type: "error", message: "Session expired." });
        client.socket.close(1008, "Unauthorised");
        return;
      }

      client.userId = userId;
      log.info({ evt: "engine.ws_authed", userId }, "socket authed");
      this.send(client, { type: "authed" });
      return;
    }

    // Everything past auth requires a session. An open socket is not an
    // authorised one.
    if (!client.userId) {
      this.send(client, { type: "error", message: "Authenticate first." });
      return;
    }

    if (message.type === "unsubscribe") {
      client.subscriptions.delete(message.symbol);
      return;
    }

    const asset = this.registry.get(message.symbol);
    if (!asset) {
      this.send(client, { type: "error", message: "Unknown asset." });
      return;
    }

    client.subscriptions.set(message.symbol, message.timeframe);

    const history = await prisma.candle.findMany({
      where: { assetId: asset.id, timeframe: message.timeframe },
      orderBy: { openTs: "desc" },
      take: HISTORY_CANDLES,
      select: { openTs: true, o: true, h: true, l: true, c: true },
    });

    this.send(client, {
      type: "candles:history",
      symbol: asset.symbol,
      timeframe: message.timeframe,
      candles: history.reverse().map((row) => ({
        openTs: Math.floor(row.openTs.getTime() / 1000),
        o: row.o,
        h: row.h,
        l: row.l,
        c: row.c,
      })),
    });

    this.send(client, {
      type: "payout:update",
      symbol: asset.symbol,
      payoutPct: asset.payoutPct,
    });
  }

  private send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
  }

  /** Fans a message out to every client subscribed to that symbol. */
  broadcast(symbol: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId && client.subscriptions.has(symbol)) {
        this.send(client, message);
      }
    }
  }

  /** Delivers to every socket authenticated as this user, regardless of subscription. */
  sendToUser(userId: string, message: ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId === userId) this.send(client, message);
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.budgetTimer);
    for (const client of this.clients) client.socket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
