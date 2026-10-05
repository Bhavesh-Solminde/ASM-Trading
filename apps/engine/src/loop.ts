import { autoPromoteHeldWithdrawals, prisma } from "@asm/db";
import { logger } from "@asm/logger";
import {
  COMMIT_WINDOW_SEC,
  MAGNET_CAP,
  MAGNET_WINDOW_SEC,
  SELF_ANCHOR_ALPHA,
  SELF_ANCHOR_ALPHA_CLOSED,
  SELF_ANCHOR_MODE,
  USE_GLG_TREASURY,
  USE_HOUSE_GOVERNOR,
  driftBias,
  expiryMagnet,
  imbalance,
  isSymbolClosedForNight,
  pathBias,
  smoothstep,
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
  desk: Pick<TradeDesk, "collectDue" | "openFor" | "preSettle">,
): { stop(): void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;
  let lastLagWarn = 0;
  let lastSentimentSec = 0;
  // First-withdrawal hold auto-promotion: one SQL UPDATE per minute. Keeps
  // the admin's "Pending" queue honest after a hold expires without needing
  // a separate scheduler process.
  let lastHoldPromoteSec = 0;

  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    const nowSec = Math.floor(startedAt / 1000);

    // Pre-settle pass. For buckets expiring NEXT tick, pick the resolved exit
    // price now and snap the chart to it so the user's countdown never ticks
    // through a visible shift at expiry. Sync, no DB. See TradeDesk.preSettle.
    desk.preSettle(nowSec, TICK_DT_SEC);

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

        // GLG per-trade duration-scaled blend. The chart is steered toward
        // each open live trade's own targetPrice for the WHOLE trade
        // duration. If no stamped trades are open, the chart wanders
        // honestly (magnet=0, bias=0). The pre-GLG aggregate-liability
        // magnet (`else` branch) is commented out below — DO NOT reactivate
        // without reviewing algorithm.md Phase 3.
        const imb = imbalance(livePositions, nowSec);
        let bias: number;
        let magnetPull = 0;

        if (USE_HOUSE_GOVERNOR || USE_GLG_TREASURY) {
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
          // GLG RETIRE 2026-10-05 — the pre-governor aggregate-liability
          // path is no longer reachable with GLG on. If both governor flags
          // are OFF (deliberate rollback), the chart wanders honestly: no
          // book-pressure bias, no last-window magnet. Reactivating the
          // retired path requires reviewing algorithm.md Phase 3 first.
          bias = 0;

          /*
           * // Pre-GLG book-pressure bias + last-window magnet. Preserved
           * // for history; DO NOT reactivate without reviewing Phase 3.
           * bias = closedNow
           *   ? 0
           *   : driftBias({
           *       imbalance: imb,
           *       exposure: totalExposure(livePositions),
           *       sigma,
           *     });
           * if (!closedNow && livePositions.length > 0 && imb !== 0) {
           *   let soonestExpiry = Infinity;
           *   for (const p of livePositions) {
           *     if (p.expirySec < soonestExpiry) soonestExpiry = p.expirySec;
           *   }
           *   const secondsLeft = soonestExpiry - nowSec;
           *   if (secondsLeft > 0 && secondsLeft <= MAGNET_WINDOW_SEC) {
           *     const bucket = livePositions.filter(
           *       (p) => p.expirySec === soonestExpiry,
           *     );
           *     let upLiab = 0;
           *     let downLiab = 0;
           *     for (const p of bucket) {
           *       const liab = (p.stake * p.payoutPct) / 100;
           *       if (p.direction === "UP") upLiab += liab;
           *       else downLiab += liab;
           *     }
           *     const wantsDown = upLiab >= downLiab;
           *     const entries = bucket.map((p) => p.entryPrice);
           *     const targetPrice = wantsDown
           *       ? Math.min(...entries) - asset.tickSize
           *       : Math.max(...entries) + asset.tickSize;
           *     magnetPull = expiryMagnet({
           *       currentPrice: asset.state.price,
           *       targetPrice,
           *       secondsLeft,
           *       convergenceWindowSec: MAGNET_WINDOW_SEC,
           *       sigma,
           *     });
           *   }
           * }
           */
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

        // Commit-phase snap. In the last COMMIT_WINDOW_SEC of a stamped live
        // trade we ease the shown price toward the trade's target with a
        // smoothstep-weighted blend, so no z draw — however extreme — can
        // pull the chart back across the target line. This is what makes
        // "chart == settled" a hard invariant. Applied only when the flag is
        // on; skipped during nightly close.
        if ((USE_HOUSE_GOVERNOR || USE_GLG_TREASURY) && !closedNow) {
          let commitTarget: number | null = null;
          let commitSecondsLeft = Infinity;
          for (const p of livePositions) {
            if (
              !p.verdict ||
              p.verdict === "HONEST" ||
              p.targetPrice === undefined ||
              p.entrySec === undefined
            ) {
              continue;
            }
            const secondsLeft = p.expirySec - nowSec;
            if (
              secondsLeft >= 0 &&
              secondsLeft <= COMMIT_WINDOW_SEC &&
              secondsLeft < commitSecondsLeft
            ) {
              commitSecondsLeft = secondsLeft;
              commitTarget = p.targetPrice;
            }
          }
          if (commitTarget !== null) {
            const commitProgress =
              1 - commitSecondsLeft / COMMIT_WINDOW_SEC;
            const w = smoothstep(commitProgress);
            const blended = (1 - w) * result.price + w * commitTarget;
            asset.state = { ...asset.state, price: blended };
            result = { ...result, price: blended };
          }
        }
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

    // Once per minute, flip HELD → REQUESTED for any withdrawal whose
    // holdUntil has passed. A single UPDATE statement; a slow DB call here
    // delays the next tick (setTimeout reschedule) rather than stacking, so
    // we fire-and-forget to keep the price path hot. Errors are logged but
    // never kill the loop.
    if (nowSec - lastHoldPromoteSec >= 60) {
      lastHoldPromoteSec = nowSec;
      void autoPromoteHeldWithdrawals().then(
        (promoted) => {
          if (promoted > 0) {
            logger.info(
              { evt: "withdrawal.hold_auto_promoted", count: promoted },
              "promoted held withdrawals to requested",
            );
          }
        },
        (err: unknown) => {
          logger.error(
            {
              evt: "withdrawal.hold_auto_promote_failed",
              reason: err instanceof Error ? err.message : "unknown",
            },
            "auto-promote tick failed",
          );
        },
      );
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
