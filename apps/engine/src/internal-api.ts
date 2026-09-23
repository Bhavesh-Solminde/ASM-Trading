import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  EngineOpenTradeSchema,
  type EngineOpenTradeInput,
  type OpenTradeResult,
} from "@asm/contracts";
import { logger } from "@asm/logger";
import { DeskRejection, type DeskRejectionReason } from "./trading/errors";

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
}): { listen(): Promise<number>; close(): Promise<void> } {
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

    if (req.method !== "POST" || req.url !== "/trades") {
      return reply(res, 404, { error: "not found" });
    }

    const raw = await readBody(req);
    if (raw === null) return reply(res, 413, { error: "payload too large" });

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply(res, 400, { error: "invalid" });
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
