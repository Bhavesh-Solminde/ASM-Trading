import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import {
  SELF_ANCHOR_ALPHA,
  SELF_ANCHOR_ALPHA_CLOSED,
  SELF_ANCHOR_MODE,
  driftBias,
  imbalance,
  isSymbolClosedForNight,
  totalExposure,
} from "@asm/algo";
import { TICK_DT_SEC } from "@asm/pricing";
import type { AssetRegistry } from "./assets/registry";
import type { EngineServer } from "./server";
import type { TradeDesk } from "./trading/trade-desk";
import { computeSentiment } from "./sentiment";

// Emit one tick per simulated-time step, derived from the shared cadence
// constant so the loop and the price model always agree on how long a tick is.
// (A hand-tuned TICK_MS that disagrees with DT_SEC makes the chart move the
// wrong amount per second and is what caused the over-frequent jitter.)
const TICK_MS = Math.round(TICK_DT_SEC * 1000);

/**
 * The tick loop (TICK_DT_SEC cadence — one update per second by default). Uses setTimeout
 * rescheduling rather than setInterval so a slow database write delays the next
 * tick instead of stacking them up.
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

    // Capture exit prices before this tick moves them: a trade expiring this
    // second settles against the price its owner last saw. No awaiting here.
    desk.collectDue(nowSec);

    for (const asset of registry.all()) {
      let result;
      try {
        // Sigma read from the pre-tick GARCH state — the same conditional
        // volatility stepPrice is about to use for this tick's z draw, so the
        // bias is scaled to the move that's actually about to happen.
        const sigma = Math.sqrt(asset.state.garch.sigma2);
        const openPositions = desk.openFor(asset.id);
        // Every asset is house-first now. India symbols observe a nightly
        // close (23:30–05:00 IST); crypto and forex are 24/7.
        const closedNow = isSymbolClosedForNight(asset.symbol, startedAt);

        // Nightly close: no book pressure decides the shown path, and the
        // accelerated self-anchor pulls shown toward honest fast enough to
        // realign before morning. During open hours every asset gets the
        // gentle baseline self-anchor so idle stretches can't accumulate
        // multi-hour drift (the bug that stranded the resolver on Bank NIFTY).
        const bias = closedNow
          ? 0
          : driftBias({
              imbalance: imbalance(openPositions, nowSec),
              exposure: totalExposure(openPositions),
              sigma,
            });

        const selfAnchorTarget = SELF_ANCHOR_MODE
          ? asset.honestState.price
          : null;
        const selfAnchorAlpha = !SELF_ANCHOR_MODE
          ? 0
          : closedNow
            ? SELF_ANCHOR_ALPHA_CLOSED
            : SELF_ANCHOR_ALPHA;

        result = registry.tick(asset.symbol, nowSec, {
          driftBias: bias,
          magnet: 0,
          selfAnchorTarget,
          selfAnchorAlpha,
        });
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

      // Once per second is plenty — the bar is a mood indicator, not a feed.
      if (nowSec !== lastSentimentSec) {
        const sentiment = computeSentiment(desk.openFor(asset.id));
        server.broadcast(asset.symbol, {
          type: "sentiment",
          symbol: asset.symbol,
          ...sentiment,
        });
      }

      for (const { timeframe, candle } of result.closed) {
        // Every timeframe's close is broadcast so live subscribers append the
        // bar in real time. Only 1m is PERSISTED, though — higher timeframes
        // are served by resampling the stored 1m candles on read (see
        // EngineServer.loadCandles), so persisting them too would be dead
        // writes.
        server.broadcast(asset.symbol, {
          type: "candle:close",
          symbol: asset.symbol,
          timeframe,
          candle,
        });

        if (timeframe !== "1m") continue;

        // upsert rather than create — a restart mid-bucket must not collide.
        await prisma.candle
          .upsert({
            where: {
              assetId_timeframe_openTs: {
                assetId: asset.id,
                timeframe,
                openTs: new Date(candle.openTs * 1000),
              },
            },
            create: {
              assetId: asset.id,
              timeframe,
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
                timeframe,
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
