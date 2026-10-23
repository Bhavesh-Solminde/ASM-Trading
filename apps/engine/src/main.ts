import { tradeViewFrom } from "@asm/contracts";
import Redis from "ioredis";
import { config } from "@asm/config";
import { logger } from "@asm/logger";
import { prisma } from "@asm/db";
import { AssetRegistry } from "./assets/registry";
import { EngineServer } from "./server";
import { startTickLoop, type CfdDeps } from "./loop";
import { createPriceFeed } from "./feeds";
import { QuoteBuffer } from "./feeds/quote-buffer";
import { GapTracker } from "./trading/gap";
import { CfdDesk } from "./trading/cfd-desk";
import { createTicketAuthenticator } from "./auth/ws-ticket";
import { createInternalApi } from "./internal-api";
import { TradeDesk } from "./trading/trade-desk";
import { startBankFeedRunner } from "./bank-feed/runner";
import { startChainWatcher } from "./chain-watcher/runner";
import { startBscWatcher } from "./chain-watcher/bsc-runner";
import { startReconciliationRunner } from "./chain-watcher/reconciliation-runner";
import { startTatumRunner } from "./tatum-runner";
import { usdtProviderFor } from "@asm/tatum";
import { ControllerBridge } from "./algo/controller-bridge";
import { BotCrowd } from "./algo/crowd";

const WS_PORT = Number(process.env.ENGINE_WS_PORT ?? 4001);
const HTTP_PORT = Number(process.env.ENGINE_HTTP_PORT ?? 4002);

async function main(): Promise<void> {
  // Built first: a missing ENGINE_INTERNAL_SECRET must fail before hydrate
  // voids trades or the tick loop starts settling them.
  let desk: TradeDesk | null = null;
  let _cfdDesk: CfdDesk | null = null;
  let _registry: AssetRegistry | null = null;

  const internal = createInternalApi({
    desk: {
      open: (input) => {
        if (!desk) throw new Error("trade desk not ready");
        return desk.open(input);
      },
    },
    secret: process.env.ENGINE_INTERNAL_SECRET ?? "",
    port: HTTP_PORT,
    ...(process.env.TRADING_MODEL === "CFD" && {
      cfdDesk: new Proxy({} as CfdDesk, {
        get(_target, prop) {
          if (!_cfdDesk) throw new Error("cfd desk not ready");
          return (_cfdDesk as unknown as Record<string, unknown>)[prop as string];
        },
      }),
      shownMidPrice: (symbol: string) => _registry?.publishedPrice(symbol) ?? 0,
    }),
  });

  const registry = new AssetRegistry(Date.now() & 0x7fffffff);
  await registry.load();
  _registry = registry;

  if (registry.symbols().length === 0) {
    throw new Error(
      "No open assets found. Run the Plan 01 seed: pnpm db:seed",
    );
  }

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  const server = new EngineServer(registry, WS_PORT, createTicketAuthenticator(redis));
  await server.ready();

  const controller = new ControllerBridge(Date.now() & 0x7fffffff);

  desk = new TradeDesk(registry, server, controller);
  const IS_CFD = process.env.TRADING_MODEL === "CFD";
  if (!IS_CFD) await desk.hydrate(Math.floor(Date.now() / 1000));
  let cfdDeps: CfdDeps | undefined;
  let feed: Awaited<ReturnType<typeof createPriceFeed>> | null = null;

  if (IS_CFD) {
    const quoteBuffer = new QuoteBuffer();
    const gapTracker = new GapTracker();
    const cfdDesk = new CfdDesk(async (tradeId) => {
      const trade = await prisma.trade.findUniqueOrThrow({
        where: { id: tradeId }, include: { asset: true, account: true },
      });
      server.sendToUser(trade.account.userId, {
        type: "trade:settled", trade: tradeViewFrom(trade, trade.asset.symbol),
      });
      server.sendToUser(trade.account.userId, {
        type: "balance:update", accountId: trade.accountId,
        realBalance: trade.account.realBalance, bonusBalance: trade.account.bonusBalance,
      });
    }, (result, actorId) => {
      server.sendToUser(actorId, { type: "balance:update", accountId: result.trade.accountId, ...result.balances });
    });

    for (const asset of registry.all()) {
      const sigma1h = registry.sigmaNow(asset.symbol) * Math.sqrt(3600);
      gapTracker.registerAsset(asset.symbol, { sigma1h, maxGapMultiple: 3 });
    }

    _cfdDesk = cfdDesk;
    cfdDeps = { quoteBuffer, gapTracker, cfdDesk };

    feed = createPriceFeed(registry.symbols());
    await feed.start((quote) => {
      quoteBuffer.update(quote);
      registry.setAnchor(quote.symbol, quote.price);
    });
  } else {
    // Binary mode: external anchors only if explicitly enabled.
    const externalAnchors = process.env["EXTERNAL_ANCHORS"] === "on";
    feed = externalAnchors ? createPriceFeed(registry.symbols()) : null;
    if (feed) {
      await feed.start((quote) => {
        registry.setAnchor(quote.symbol, quote.price);
      });
    }
  }

  const loop = startTickLoop(registry, server, desk, cfdDeps);

  await internal.listen();

  const bankFeed = await startBankFeedRunner();
  // USDT detection: exactly one provider runs PER NETWORK. The Tatum gateway
  // (default) or, when that network's provider is "manual", the original
  // shared-address TronGrid/BSC watcher — never both on one network, so
  // nothing is double-processed. The Tatum runner only polls its own networks.
  const idleWatcher = { stop: async () => {} };
  const chainWatcher = usdtProviderFor("tron") === "manual" ? await startChainWatcher() : idleWatcher;
  const bscWatcher = usdtProviderFor("bsc") === "manual" ? await startBscWatcher() : idleWatcher;
  const tatumRunner = startTatumRunner();
  const reconciliationRunner = startReconciliationRunner();

  const crowd = new BotCrowd(registry, desk, (Date.now() >>> 1) & 0x7fffffff);
  if (process.env.TRADING_MODEL !== "CFD" && process.env.BOTS_ENABLED !== "false") {
    await crowd.provision();
    crowd.start();
  }

  logger.info({ evt: "engine.started", wsPort: WS_PORT, httpPort: HTTP_PORT }, "engine started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ evt: "engine.stopping", signal }, "shutting down");
    await internal.close(); // accept no new trades
    crowd.stop(); // stop bots from opening new ones
    await bankFeed.stop(); // inject no new credits
    await reconciliationRunner.stop(); // inject no new findings
    await chainWatcher.stop(); // inject no new USDT credits
    await bscWatcher.stop(); // …on either network
    await tatumRunner.stop(); // …or via the Tatum gateway
    loop.stop(); // collect no new settlements
    await desk?.stop(); // let captured settlements persist (bounded)
    if (feed) await feed.stop();
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
