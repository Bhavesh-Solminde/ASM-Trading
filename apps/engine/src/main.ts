import Redis from "ioredis";
import { config } from "@asm/config";
import { logger } from "@asm/logger";
import { prisma, provisionBots } from "@asm/db";
import { createRng } from "@asm/pricing";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";
import { startTickLoop } from "./loop";
import { createPriceFeed } from "./feeds/twelve-data";
import { createTicketAuthenticator } from "./auth/ws-ticket";
import { createInternalApi } from "./internal-api";
import { TradeDesk } from "./trading/trade-desk";
import { startBankFeedRunner } from "./bank-feed/runner";
import { ControllerBridge } from "./controller-bridge";
import { BotCrowd } from "./bots/crowd";

const WS_PORT = Number(process.env.ENGINE_WS_PORT ?? 4001);
const HTTP_PORT = Number(process.env.ENGINE_HTTP_PORT ?? 4002);

async function main(): Promise<void> {
  // Built first: a missing ENGINE_INTERNAL_SECRET must fail before hydrate
  // voids trades or the tick loop starts settling them.
  let desk: TradeDesk | null = null;
  const internal = createInternalApi({
    desk: {
      open: (input) => {
        if (!desk) throw new Error("trade desk not ready");
        return desk.open(input);
      },
    },
    secret: process.env.ENGINE_INTERNAL_SECRET ?? "",
    port: HTTP_PORT,
  });

  const registry = new AssetRegistry(Date.now() & 0x7fffffff);
  await registry.load();

  if (registry.symbols().length === 0) {
    throw new Error(
      "No open assets found. Run the Plan 01 seed: pnpm db:seed",
    );
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const server = new EngineServer(registry, WS_PORT, createTicketAuthenticator(redis));
  await server.ready();

  // Controller bridge: pure win-rate steering. Seeded from clock so each
  // engine restart gets an independent RNG sequence.
  const bridge = new ControllerBridge(createRng(Date.now() & 0x7fffffff));

  desk = new TradeDesk(
    registry,
    server,
    Date.now,
    (accountId) => bridge.invalidate(accountId),
  );
  await desk.hydrate(Math.floor(Date.now() / 1000));

  const loop = startTickLoop(registry, server, desk);

  const feed = createPriceFeed(registry.symbols());
  await feed.start((quote) => {
    registry.setAnchor(quote.symbol, quote.price);
  });

  await internal.listen();

  const bankFeed = await startBankFeedRunner();

  // Bot crowd — kept alive as long as BOTS_ENABLED !== "false".
  let crowd: BotCrowd | null = null;
  if (process.env["BOTS_ENABLED"] !== "false") {
    const BOT_COUNT = Number(process.env["BOT_COUNT"] ?? 20);
    const bots = await provisionBots(BOT_COUNT, 10_000_000);
    crowd = new BotCrowd(bots, registry);
    crowd.start();
  }

  logger.info({ evt: "engine.started", wsPort: WS_PORT, httpPort: HTTP_PORT }, "engine started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ evt: "engine.stopping", signal }, "shutting down");
    await internal.close();
    await bankFeed.stop();
    await crowd?.stop();
    loop.stop();
    await desk?.stop();
    await feed.stop();
    await server.stop();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // A10:2025 — mishandled exceptional conditions. Log and exit cleanly so the
  // supervisor restarts us, rather than limping on in an unknown state.
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { evt: "engine.unhandled_rejection", reason: String(reason) },
      "unhandled rejection — exiting",
    );
    process.exit(1);
  });
}

void main().catch((err: unknown) => {
  logger.error(
    { evt: "engine.start_failed", reason: err instanceof Error ? err.message : "unknown" },
    "engine failed to start",
  );
  process.exit(1);
});
