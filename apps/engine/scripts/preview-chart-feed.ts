/**
 * Local chart-only preview using recorded candles. This entrypoint never loads
 * the trading loop, bots, deposit watchers, or settlement services. It retains
 * normal one-time ticket authentication and binds only to loopback.
 *
 * From the repository root:
 * CHART_PREVIEW_PORT=4051 pnpm --filter @asm/engine exec dotenv -e ../../.env -- tsx scripts/preview-chart-feed.ts
 */
import Redis from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import { prisma, type DbTransaction } from "@asm/db";
import { ClientMessageSchema, TIMEFRAME_SEC, type CandleDto, type ServerMessage, type Timeframe } from "@asm/contracts";
import { resample } from "@asm/pricing";
import { createTicketAuthenticator } from "../src/auth/ws-ticket";

if (process.env.NODE_ENV === "production") throw new Error("Local preview only.");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required for normal session tickets.");

// Database-enforced read-only transactions: even an accidental future mutation
// inside a preview query cannot change the shared database.
function readOnly<T>(read: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx);
  });
}

const assets = await readOnly(tx => tx.asset.findMany({
  where: { isOpen: true }, select: { id: true, symbol: true, payoutPct: true },
}));
const bySymbol = new Map(assets.map(asset => [asset.symbol, asset]));
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
const authenticate = createTicketAuthenticator(redis);
const port = Number(process.env.CHART_PREVIEW_PORT ?? 4051);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port.");

async function history(assetId: string, timeframe: Timeframe, limit: number, before?: number) {
  const ratio = TIMEFRAME_SEC[timeframe] / 60;
  const take = Math.min(limit * ratio + (ratio > 1 ? ratio : 0), 8000);
  const rows = await readOnly(tx => tx.candle.findMany({
    where: { assetId, timeframe: "1m", ...(before === undefined ? {} : { openTs: { lt: new Date(before * 1000) } }) },
    orderBy: { openTs: "desc" }, take,
    select: { openTs: true, o: true, h: true, l: true, c: true },
  }));
  const minutes: CandleDto[] = rows.reverse().map(row => ({
    openTs: Math.floor(row.openTs.getTime() / 1000), o: row.o, h: row.h, l: row.l, c: row.c,
  }));
  return { candles: resample(minutes, TIMEFRAME_SEC[timeframe]).slice(-limit), reachedStart: rows.length < take };
}

const allowedOrigins = new Set((process.env.CHART_PREVIEW_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(","));
const server = new WebSocketServer({
  host: "127.0.0.1", port, maxPayload: 16 * 1024,
  verifyClient: ({ origin }) => allowedOrigins.has(origin),
});
function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
server.on("connection", socket => {
  let authed = false;
  let queued = Promise.resolve();
  let budget = 60;
  const timeout = setTimeout(() => socket.close(1008, "Unauthorised"), 10000);
  const resetBudget = setInterval(() => { budget = 60; }, 10000);
  const cleanup = () => { clearTimeout(timeout); clearInterval(resetBudget); };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  send(socket, { type: "ready", serverTs: Date.now() });
  socket.on("message", raw => {
    if (--budget < 0) { socket.close(1008, "Too many messages"); return; }
    queued = queued.then(async () => {
      let value: unknown;
      try { value = JSON.parse(raw.toString()); } catch { socket.close(1008, "Invalid message"); return; }
      const parsed = ClientMessageSchema.safeParse(value);
      if (!parsed.success) { socket.close(1008, "Invalid message"); return; }
      const message = parsed.data;
      if (message.type === "auth") {
        if (authed || !await authenticate(message.token)) { socket.close(1008, "Unauthorised"); return; }
        authed = true;
        clearTimeout(timeout);
        send(socket, { type: "authed" });
        return;
      }
      if (!authed) { socket.close(1008, "Unauthorised"); return; }
      if (message.type === "unsubscribe") return;
      const asset = bySymbol.get(message.symbol);
      if (!asset) { send(socket, { type: "error", message: "Unknown asset." }); return; }
      const older = message.type === "candles:loadOlder";
      const result = await history(asset.id, message.timeframe, older ? message.limit : 180, older ? message.before : undefined);
      if (older) {
        send(socket, { type: "candles:older", symbol: asset.symbol, timeframe: message.timeframe, ...result });
      } else {
        send(socket, { type: "candles:history", symbol: asset.symbol, timeframe: message.timeframe, candles: result.candles });
        send(socket, { type: "payout:update", symbol: asset.symbol, payoutPct: asset.payoutPct });
        console.log(`Recorded preview: ${asset.symbol} ${message.timeframe}, ${result.candles.length} candles`);
      }
    }).catch(() => {
      console.error("Preview history/authentication unavailable; closing connection.");
      socket.close(1011, "Preview unavailable");
    });
  });
});
server.on("listening", () => console.log(`Chart preview: ws://127.0.0.1:${port} — RECORDED HISTORY ONLY; no trading or payment services.`));
server.on("error", error => { console.error(error.message); void stop(); });
async function stop() {
  for (const socket of server.clients) socket.terminate();
  server.close();
  await redis.quit();
  await prisma.$disconnect();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
