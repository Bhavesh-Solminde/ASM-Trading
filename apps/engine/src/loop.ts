import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { driftBias, imbalance, totalExposure } from "@asm/algo";
import type { AssetRegistry } from "./assets/registry";
import type { TickBias } from "./assets/registry";
import type { EngineServer } from "./server";
import type { TradeDesk } from "./trading/trade-desk";
import { computeSentiment } from "./sentiment";

const TICK_MS = 100;

/**
 * The 10 Hz tick loop. Uses setTimeout rescheduling rather than setInterval so
 * a slow database write delays the next tick instead of stacking them up.
 */
export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
  desk: Pick<TradeDesk, "collectDue" | "openFor">,
): { stop(): void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;
  let lastLagWarn = 0;
  let lastSentimentSec = 0;

  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    const nowSec = Math.floor(startedAt / 1000);

    // Build per-asset tick data before advancing prices so collectDue sees
    // the honest price from the SAME tick, not the one before.
    const tickData = new Map<string, { honestPrice: number; sigmaTick: number }>();

    // Capture exit prices before this tick moves them.
    desk.collectDue(nowSec, tickData);

    for (const asset of registry.all()) {
      let result;
      try {
        // Compute imbalance-based drift bias for this asset.
        const positions = desk.openFor(asset.id);
        const exp = totalExposure(positions);
        const imb = imbalance(positions, nowSec);

        // sigmaTick is not yet known before the tick — use the previous tick's
        // sigma from the honest state as the cap reference. This is one tick
        // stale but that is acceptable.
        const prevSigmaTick = Math.sqrt(asset.honestState.garch.sigma2 * 0.1);

        const bias: TickBias = {
          driftBias: driftBias({ imbalance: imb, exposure: exp, sigmaTick: prevSigmaTick }),
          magnet: 0,
        };

        result = registry.tick(asset.symbol, nowSec, bias);
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

      tickData.set(asset.symbol, { honestPrice: result.honestPrice, sigmaTick: result.sigmaTick });

      server.broadcast(asset.symbol, {
        type: "tick",
        symbol: asset.symbol,
        price: result.price,
        ts: nowSec,
      });

      // Once per second is plenty — the bar is a mood indicator, not a feed.
      if (nowSec !== lastSentimentSec) {
        const sentiment = computeSentiment(desk.openFor(asset.id));
        server.broadcast(asset.symbol, {
          type: "sentiment",
          symbol: asset.symbol,
          ...sentiment,
        });
      }

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
              shadowO: result.honestClosed?.o ?? null,
              shadowH: result.honestClosed?.h ?? null,
              shadowL: result.honestClosed?.l ?? null,
              shadowC: result.honestClosed?.c ?? null,
            },
            update: {
              h: candle.h,
              l: candle.l,
              c: candle.c,
              shadowH: result.honestClosed?.h ?? null,
              shadowL: result.honestClosed?.l ?? null,
              shadowC: result.honestClosed?.c ?? null,
            },
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

    lastSentimentSec = nowSec;

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
