import { WebSocketServer, type WebSocket } from "ws";
import { createHash } from "node:crypto";
import {
  ClientMessageSchema,
  type ServerMessage,
  type Timeframe,
} from "@asm/contracts";
import { prisma } from "@asm/db";
import { childLogger, newCorrelationId, logger } from "@asm/logger";
import type { AssetRegistry } from "./assets/registry";

interface Client {
  socket: WebSocket;
  userId: string | null;
  subscriptions: Map<string, Timeframe>;
  cid: string;
  messageBudget: number;
}

const MESSAGE_BUDGET_PER_WINDOW = 60;
const BUDGET_WINDOW_MS = 10_000;
const HISTORY_CANDLES = 120;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class EngineServer {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private budgetTimer: NodeJS.Timeout;

  constructor(
    private readonly registry: AssetRegistry,
    port: number,
  ) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => this.onConnection(socket));

    this.budgetTimer = setInterval(() => {
      for (const client of this.clients) {
        client.messageBudget = MESSAGE_BUDGET_PER_WINDOW;
      }
    }, BUDGET_WINDOW_MS);

    logger.info({ evt: "engine.ws_listening", port }, "websocket server listening");
  }

  private onConnection(socket: WebSocket): void {
    const client: Client = {
      socket,
      userId: null,
      subscriptions: new Map(),
      cid: newCorrelationId(),
      messageBudget: MESSAGE_BUDGET_PER_WINDOW,
    };
    this.clients.add(client);

    socket.on("message", (raw) => void this.onMessage(client, raw.toString()));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));

    this.send(client, { type: "ready", serverTs: Date.now() });
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    const log = childLogger(client.cid);

    // Per-connection budget — an authenticated socket is still a rate-limited one.
    if (client.messageBudget-- <= 0) {
      log.warn({ evt: "security.rate_limited", channel: "ws" }, "message budget exceeded");
      client.socket.close(1008, "Too many messages");
      return;
    }

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
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashToken(message.token) },
        select: { userId: true, expiresAt: true },
      });

      if (!session || session.expiresAt.getTime() < Date.now()) {
        this.send(client, { type: "error", message: "Session expired." });
        client.socket.close(1008, "Unauthorised");
        return;
      }

      client.userId = session.userId;
      log.info({ evt: "engine.ws_authed", userId: session.userId }, "socket authed");
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

  async stop(): Promise<void> {
    clearInterval(this.budgetTimer);
    for (const client of this.clients) client.socket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
