import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import type { AssetRegistry } from "./assets/registry";
import type { EngineServer } from "./server";
import type { TradeDesk } from "./trading/trade-desk";

const TICK_MS = 100;

/**
 * The 10 Hz tick loop. Uses setTimeout rescheduling rather than setInterval so
 * a slow database write delays the next tick instead of stacking them up.
 */
export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
  desk: Pick<TradeDesk, "collectDue">,
): { stop(): void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;
  let lastLagWarn = 0;

  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    const nowSec = Math.floor(startedAt / 1000);

    // Capture exit prices before this tick moves them: a trade expiring this
    // second settles against the price its owner last saw. No awaiting here.
    desk.collectDue(nowSec);

    for (const asset of registry.all()) {
      let result;
      try {
        result = registry.tick(asset.symbol, nowSec);
      } catch (err) {
        logger.error(
          {
            evt: "engine.tick_failed",
            symbol: asset.symbol,
            reason: err instanceof Error ? err.message : "unknown",
          },
          "tick failed",
        );
        continue;
      }

      server.broadcast(asset.symbol, {
        type: "tick",
        symbol: asset.symbol,
        price: result.price,
        ts: nowSec,
      });

      if (result.closed) {
        const candle = result.closed;
        server.broadcast(asset.symbol, {
          type: "candle:close",
          symbol: asset.symbol,
          timeframe: "1m",
          candle,
        });

        // upsert rather than create — a restart mid-minute must not collide.
        await prisma.candle
          .upsert({
            where: {
              assetId_timeframe_openTs: {
                assetId: asset.id,
                timeframe: "1m",
                openTs: new Date(candle.openTs * 1000),
              },
            },
            create: {
              assetId: asset.id,
              timeframe: "1m",
              openTs: new Date(candle.openTs * 1000),
              o: candle.o,
              h: candle.h,
              l: candle.l,
              c: candle.c,
            },
            update: { h: candle.h, l: candle.l, c: candle.c },
          })
          .catch((err: unknown) => {
            logger.error(
              {
                evt: "engine.candle_persist_failed",
                symbol: asset.symbol,
                openTs: candle.openTs,
                reason: err instanceof Error ? err.message : "unknown",
              },
              "candle persist failed",
            );
          });
      }
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > TICK_MS * 3 && Date.now() - lastLagWarn > 30_000) {
      lastLagWarn = Date.now();
      logger.warn(
        { evt: "engine.tick_lag", elapsedMs: elapsed, budgetMs: TICK_MS },
        "tick loop is falling behind",
      );
    }

    if (running) {
      timer = setTimeout(() => void run(), Math.max(0, TICK_MS - elapsed));
    }
  };

  void run();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
