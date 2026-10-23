import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  EngineOpenTradeSchema,
  EngineCfdOpenTradeSchema,
  CfdCloseTradeSchema,
  CfdModifyTradeSchema,
  type EngineOpenTradeInput,
  type OpenTradeResult,
  type EngineCfdOpenTradeInput,
  type CfdOpenTradeResult,
} from "@asm/contracts";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { dynamicMaxStake, exposureCap, dailyWinCap, isDailyCircuitBroken } from "@asm/algo";
import { DeskRejection, type DeskRejectionReason } from "./trading/errors";
import type { CfdDesk, AssetConfig, RiskLimits, ClosedPosition } from "./trading/cfd-desk";

const MAX_BODY_BYTES = 4_096;

export interface TradeOpener {
  open(input: EngineOpenTradeInput): Promise<OpenTradeResult>;
}

const REJECTION_STATUS: Record<DeskRejectionReason, number> = {
  unknown_asset: 404,
  account_not_found: 404,
  insufficient_funds: 409,
  // 403 for a paused account — the caller is authenticated but the resource
  // is not usable in its current state, matching the withdrawal refusal path.
  account_not_active: 403,
  // Phase 2D nightly OTC close: the asset itself is temporarily unavailable
  // for new opens. 503 matches how other temporary-unavailability paths
  // surface to callers.
  market_closed: 503,
};

function authorised(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Resolves to the body, or null if it exceeds MAX_BODY_BYTES. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * The engine's loopback-only control surface.
 *
 *   POST /trades   EngineOpenTradeInput -> 201 OpenTradeResult
 *
 * When `sharedServer` is provided (production / Render) the handler is
 * attached to that server instead of creating its own; listen() becomes a
 * no-op in that case because the caller is responsible for starting the
 * server.  When `sharedServer` is absent the original behaviour is
 * preserved — a standalone server bound to 127.0.0.1:`port`.
 */
export function createInternalApi(deps: {
  desk: TradeOpener;
  secret: string;
  port: number;
  /** Provide to share a single port with the WebSocket server. */
  sharedServer?: Server;
  tradingModel?: "BINARY" | "CFD";
  cfdDesk?: CfdDesk;
  /** Returns the current shown mid-price for a symbol, for CFD opens. */
  shownMidPrice?: (symbol: string) => number;
}): { listen(): Promise<number>; close(): Promise<void> } {
  const isCfd = (deps.tradingModel ?? process.env.TRADING_MODEL) === "CFD";
  if (!deps.secret) {
    throw new Error(
      "ENGINE_INTERNAL_SECRET is not set. The engine refuses to expose an unauthenticated control surface.",
    );
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorised(req.headers.authorization, deps.secret)) {
      logger.warn({ evt: "security.authz_denied", route: "engine_internal" }, "internal api auth failed");
      return reply(res, 401, { error: "unauthorised" });
    }

    const raw = await readBody(req);
    if (raw === null) return reply(res, 413, { error: "payload too large" });

    let json: unknown;
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return reply(res, 400, { error: "invalid" });
    }

    const url = req.url ?? "";
    const method = req.method ?? "";

    if (method === "POST" && url === "/trades" && isCfd) {
      return reply(res, 409, { error: "trading_model_mismatch" });
    }

    // ── CFD routes ────────────────────────────────────────────────
    if (isCfd && deps.cfdDesk && deps.shownMidPrice) {
      if (method === "POST" && url === "/cfd/trades") {
        return handleCfdOpen(json, deps.cfdDesk, deps.shownMidPrice, res);
      }
      const closeMatch = url.match(/^\/cfd\/trades\/([^/]+)\/close$/);
      if (method === "POST" && closeMatch) {
        return handleCfdClose(closeMatch[1]!, deps.cfdDesk, deps.shownMidPrice, res);
      }
      const modifyMatch = url.match(/^\/cfd\/trades\/([^/]+)$/);
      if (method === "PATCH" && modifyMatch) {
        return handleCfdModify(modifyMatch[1]!, json, deps.cfdDesk, res);
      }
    }

    // ── Binary route ──────────────────────────────────────────────
    if (method !== "POST" || url !== "/trades") {
      return reply(res, 404, { error: "not found" });
    }

    const parsed = EngineOpenTradeSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { evt: "security.validation_rejected", route: "engine_internal" },
        "rejected internal trade payload",
      );
      return reply(res, 400, { error: "invalid" });
    }

    try {
      return reply(res, 201, await deps.desk.open(parsed.data));
    } catch (err) {
      if (err instanceof DeskRejection) {
        return reply(res, REJECTION_STATUS[err.reason], { error: err.reason });
      }
      logger.error(
        { evt: "trade.open_failed", reason: err instanceof Error ? err.message : "unknown" },
        "trade open failed",
      );
      return reply(res, 500, { error: "internal" });
    }
  }

  function requestHandler(req: IncomingMessage, res: ServerResponse): void {
    // A caller that disconnects mid-body rejects readBody. Left unhandled,
    // that reaches main's unhandledRejection handler and exits the whole engine.
    handle(req, res).catch((err: unknown) => {
      logger.error(
        { evt: "engine.internal_api_error", reason: err instanceof Error ? err.message : "unknown" },
        "internal api request failed",
      );
      if (res.headersSent || res.destroyed) res.destroy();
      else reply(res, 500, { error: "internal" });
    });
  }

  // Shared-server mode: attach our handler to the caller-owned server.
  if (deps.sharedServer) {
    const sharedServer = deps.sharedServer;
    sharedServer.on("request", requestHandler);

    return {
      async listen() {
        // The caller is responsible for calling server.listen(); nothing to do here.
        const address = sharedServer.address();
        const port = typeof address === "object" && address !== null ? address.port : deps.port;
        logger.info({ evt: "engine.internal_api_listening", port, mode: "shared" }, "internal api attached to shared server");
        return port;
      },
      async close() {
        sharedServer.off("request", requestHandler);
      },
    };
  }

  // Standalone mode: own server. Binds to loopback by default so a dev
  // machine cannot serve this control surface to the LAN. In production it
  // must reach the web container over the docker network, so ENGINE_HTTP_HOST
  // is set to 0.0.0.0 there — safe because the port is not published to the
  // host and every request still needs the shared bearer secret.
  const host = process.env.ENGINE_HTTP_HOST ?? "127.0.0.1";
  const server: Server = createServer(requestHandler);

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(deps.port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : deps.port;
      logger.info({ evt: "engine.internal_api_listening", port, mode: "standalone" }, "internal api listening");
      return port;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ── CFD handler helpers ─────────────────────────────────────────────

async function buildRiskLimits(accountId: string): Promise<RiskLimits> {
  const treasury = await prisma.houseTreasury.findUnique({ where: { id: 1 } });
  const treasuryMinor = treasury?.treasuryMinor ?? 30_000_000;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayTrades = await prisma.trade.findMany({
    where: { accountId, closedAt: { gte: todayStart }, durationSec: { not: null } },
    select: { pnl: true },
  });
  const userDailyPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);

  const openLongs = await prisma.trade.aggregate({
    where: { status: "OPEN", direction: "UP", durationSec: { not: null } },
    _sum: { stake: true },
  });
  const openShorts = await prisma.trade.aggregate({
    where: { status: "OPEN", direction: "DOWN", durationSec: { not: null } },
    _sum: { stake: true },
  });
  const netExposure = (openLongs._sum.stake ?? 0) - (openShorts._sum.stake ?? 0);

  const activeAccounts = await prisma.trade.findMany({
    where: { status: "OPEN", durationSec: { not: null } },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const activeUsers = activeAccounts.length;

  const houseDay = await prisma.houseDay.findFirst({
    where: { date: { gte: todayStart } },
    select: { realizedProfitMinor: true },
  });

  return {
    treasuryMinor,
    netExposure,
    exposureCap: exposureCap(activeUsers),
    userDailyPnl,
    dailyWinCap: dailyWinCap(treasuryMinor),
    dynamicMaxStake: dynamicMaxStake(treasuryMinor),
    isCircuitBroken: isDailyCircuitBroken(houseDay?.realizedProfitMinor ?? 0, treasuryMinor),
  };
}

async function handleCfdOpen(
  json: unknown,
  cfdDesk: CfdDesk,
  shownMidPrice: (symbol: string) => number,
  res: ServerResponse,
): Promise<void> {
  const parsed = EngineCfdOpenTradeSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn({ evt: "security.validation_rejected", route: "cfd_open" }, "rejected CFD trade payload");
    return reply(res, 400, { error: "invalid" });
  }

  const input = parsed.data;

  const asset = await prisma.asset.findFirst({
    where: { symbol: input.symbol, isOpen: true },
    select: { id: true, symbol: true, spreadBps: true },
  });
  if (!asset) return reply(res, 404, { error: "unknown_asset" });

  try {
    const risk = await buildRiskLimits(input.accountId);
    const midPrice = shownMidPrice(asset.symbol);
    if (!Number.isFinite(midPrice) || midPrice <= 0) return reply(res, 503, { error: "market_unavailable" });
    const result = await cfdDesk.open(input, midPrice, asset as AssetConfig, risk);
    return reply(res, 201, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal";
    const errorMap: Record<string, number> = {
      MARKET_UNAVAILABLE: 503,
      TRADING_PAUSED: 403,
      STAKE_EXCEEDS_LIMIT: 400,
      INSUFFICIENT_BALANCE: 409,
    };
    if (msg in errorMap) return reply(res, errorMap[msg]!, { error: msg.toLowerCase() });
    logger.error({ evt: "cfd.open_failed", reason: msg }, "CFD open failed");
    return reply(res, 500, { error: "internal" });
  }
}

async function handleCfdClose(
  tradeId: string,
  cfdDesk: CfdDesk,
  shownMidPrice: (symbol: string) => number,
  res: ServerResponse,
): Promise<void> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { asset: { select: { id: true, symbol: true, spreadBps: true } } },
  });
  if (!trade || !trade.asset) return reply(res, 404, { error: "not_found" });
  if (trade.status !== "OPEN") return reply(res, 409, { error: "trade_not_open" });

  const risk = await buildRiskLimits(trade.accountId);
  const midPrice = shownMidPrice(trade.asset.symbol);
  if (!Number.isFinite(midPrice) || midPrice <= 0) return reply(res, 503, { error: "market_unavailable" });

  try {
    const result = await cfdDesk.manualClose(
      tradeId,
      midPrice,
      trade.asset as AssetConfig,
      risk.userDailyPnl,
      risk.dailyWinCap,
    );
    return reply(res, 200, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal";
    if (msg === "LOCKOUT_ACTIVE") return reply(res, 409, { error: "lockout_active" });
    if (msg === "TRADE_NOT_OPEN") return reply(res, 409, { error: "trade_not_open" });
    logger.error({ evt: "cfd.close_failed", tradeId, reason: msg }, "CFD manual close failed");
    return reply(res, 500, { error: "internal" });
  }
}

async function handleCfdModify(
  tradeId: string,
  json: unknown,
  cfdDesk: CfdDesk,
  res: ServerResponse,
): Promise<void> {
  const parsed = CfdModifyTradeSchema.safeParse({ tradeId, ...(json as object) });
  if (!parsed.success) return reply(res, 400, { error: "invalid" });

  try {
    const changes: { stopLoss?: number | null; takeProfit?: number | null } = {};
    if (parsed.data.stopLoss !== undefined) changes.stopLoss = parsed.data.stopLoss;
    if (parsed.data.takeProfit !== undefined) changes.takeProfit = parsed.data.takeProfit;
    await cfdDesk.modify(tradeId, changes);
    return reply(res, 200, { ok: true });
  } catch (err) {
    logger.error(
      { evt: "cfd.modify_failed", tradeId, reason: err instanceof Error ? err.message : "unknown" },
      "CFD modify failed",
    );
    return reply(res, 500, { error: "internal" });
  }
}
