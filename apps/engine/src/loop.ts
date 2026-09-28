import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import {
  MAGNET_CAP,
  MAGNET_WINDOW_SEC,
  SELF_ANCHOR_ALPHA,
  SELF_ANCHOR_ALPHA_CLOSED,
  SELF_ANCHOR_MODE,
  USE_HOUSE_GOVERNOR,
  driftBias,
  expiryMagnet,
  imbalance,
  isSymbolClosedForNight,
  pathBias,
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
        const livePositions = openPositions.filter((p) => !p.isDemo);
        // Every asset is house-first now. India symbols observe a nightly
        // close (23:30–05:00 IST); crypto and forex are 24/7.
        const closedNow = isSymbolClosedForNight(asset.symbol, startedAt);

        // Two mutually exclusive paths:
        //   - USE_HOUSE_GOVERNOR: per-trade duration-scaled blend. The chart
        //     is steered toward each open live trade's own targetPrice for the
        //     WHOLE trade duration. If no non-HONEST trades are open, the
        //     chart wanders honestly (magnet=0, bias=0).
        //   - Legacy: pre-governor aggregate-liability magnet in the last
        //     MAGNET_WINDOW_SEC of the soonest bucket.
        const imb = imbalance(livePositions, nowSec);
        let bias: number;
        let magnetPull = 0;

        if (USE_HOUSE_GOVERNOR) {
          // No book-pressure bias between trades. Only per-trade steering.
          bias = 0;

          if (!closedNow) {
            const currentPrice = asset.state.price;
            let numer = 0; // sum of liability * pathBias * gap
            let denom = 0; // sum of liability
            for (const p of livePositions) {
              // A trade without a governor stamp — pre-existing row, or one
              // opened while the flag was off — grandfathers as HONEST.
              if (
                !p.verdict ||
                p.verdict === "HONEST" ||
                !p.pathStyle ||
                p.targetPrice === undefined ||
                p.entrySec === undefined
              ) {
                continue;
              }
              const duration = p.expirySec - p.entrySec;
              if (duration <= 0) continue;
              const elapsedFrac = Math.max(
                0,
                Math.min(1, (nowSec - p.entrySec) / duration),
              );
              const pb = pathBias(p.pathStyle, elapsedFrac);
              if (pb === 0) continue;
              const gap = Math.log(p.targetPrice / currentPrice);
              if (!Number.isFinite(gap) || gap === 0) continue;
              const liability = (p.stake * p.payoutPct) / 100;
              // Extra tightening in the last MAGNET_WINDOW_SEC so the last
              // ticks can't drift the price back across the target.
              const secondsLeft = p.expirySec - nowSec;
              const tighten =
                secondsLeft > 0 && secondsLeft <= MAGNET_WINDOW_SEC
                  ? 1 +
                    (MAGNET_WINDOW_SEC - secondsLeft) / MAGNET_WINDOW_SEC
                  : 1;
              numer += liability * pb * gap * tighten;
              denom += liability;
            }
            if (denom > 0) {
              const combined = numer / denom;
              const cap = MAGNET_CAP * sigma;
              magnetPull =
                combined > cap ? cap : combined < -cap ? -cap : combined;
            }
          }
        } else {
          // Legacy pre-governor path — book-pressure bias + last-window magnet.
          bias = closedNow
            ? 0
            : driftBias({
                imbalance: imb,
                exposure: totalExposure(livePositions),
                sigma,
              });

          if (!closedNow && livePositions.length > 0 && imb !== 0) {
            let soonestExpiry = Infinity;
            for (const p of livePositions) {
              if (p.expirySec < soonestExpiry) soonestExpiry = p.expirySec;
            }
            const secondsLeft = soonestExpiry - nowSec;
            if (secondsLeft > 0 && secondsLeft <= MAGNET_WINDOW_SEC) {
              const bucket = livePositions.filter(
                (p) => p.expirySec === soonestExpiry,
              );
              let upLiab = 0;
              let downLiab = 0;
              for (const p of bucket) {
                const liab = (p.stake * p.payoutPct) / 100;
                if (p.direction === "UP") upLiab += liab;
                else downLiab += liab;
              }
              const wantsDown = upLiab >= downLiab;
              const entries = bucket.map((p) => p.entryPrice);
              const targetPrice = wantsDown
                ? Math.min(...entries) - asset.tickSize
                : Math.max(...entries) + asset.tickSize;
              magnetPull = expiryMagnet({
                currentPrice: asset.state.price,
                targetPrice,
                secondsLeft,
                convergenceWindowSec: MAGNET_WINDOW_SEC,
                sigma,
              });
            }
          }
        }

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
          magnet: magnetPull,
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
