import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";
import { startTickLoop } from "./loop";
import { createPriceFeed } from "./feeds/twelve-data";

const WS_PORT = Number(process.env.ENGINE_WS_PORT ?? 4001);

async function main(): Promise<void> {
  const registry = new AssetRegistry(Date.now() & 0x7fffffff);
  await registry.load();

  if (registry.symbols().length === 0) {
    throw new Error(
      "No open assets found. Run the Plan 01 seed: pnpm db:seed",
    );
  }

  const server = new EngineServer(registry, WS_PORT);
  const loop = startTickLoop(registry, server);

  const feed = createPriceFeed(registry.symbols());
  await feed.start((quote) => {
    registry.setAnchor(quote.symbol, quote.price);
  });

  logger.info({ evt: "engine.started", wsPort: WS_PORT }, "engine started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ evt: "engine.stopping", signal }, "shutting down");
    loop.stop();
    await feed.stop();
    await server.stop();
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
