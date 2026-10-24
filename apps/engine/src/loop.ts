import { marketStatus } from "@asm/contracts";
import {
  autoPromoteHeldWithdrawals,
  istDateOf,
  listAffiliateAccountsNeedingReset,
  prisma,
  resetAffiliateAccountFloat,
} from "@asm/db";
import { logger } from "@asm/logger";
import {
  MAGNET_CAP,
  SELF_ANCHOR_ALPHA,
  SELF_ANCHOR_ALPHA_CLOSED,
  SELF_ANCHOR_MODE,
  USE_GLG_TREASURY,
  USE_HOUSE_GOVERNOR,
  isSymbolClosedForNight,
  pathBias,
  computeMagnetPull,
  type MagnetPosition,
} from "@asm/algo";
import { TICK_DT_SEC } from "@asm/pricing";
import type { AssetRegistry } from "./assets/registry";
import type { EngineServer } from "./server";
import type { TradeDesk } from "./trading/trade-desk";
import { computeSentiment } from "./sentiment";
import type { QuoteBuffer } from "./feeds/quote-buffer";
import { GapTracker, cryptoMaintenancePhase, isMarketClosed, assetCategory } from "./trading/gap";
import type { CfdDesk } from "./trading/cfd-desk";

// Emit one tick per simulated-time step, derived from the shared cadence
// constant so the loop and the price model always agree on how long a tick is.
// (A hand-tuned TICK_MS that disagrees with DT_SEC makes the chart move the
// wrong amount per second and is what caused the over-frequent jitter.)
const TICK_MS = Math.round(TICK_DT_SEC * 1000);
const IS_CFD = process.env.TRADING_MODEL === "CFD";

export interface CfdDeps {
  quoteBuffer: QuoteBuffer;
  gapTracker: GapTracker;
  cfdDesk: CfdDesk;
}

/**
 * The tick loop (TICK_DT_SEC cadence — one update per second by default). Uses setTimeout
 * rescheduling rather than setInterval so a slow database write delays the next
 * tick instead of stacking them up.
 */
export function startTickLoop(
  registry: AssetRegistry,
  server: EngineServer,
  desk: Pick<TradeDesk, "collectDue" | "openFor" | "preSettle" | "recoverExpiredLegacy">,
  cfdDeps?: CfdDeps,
): { stop(): void } {
  let running = true;
  let timer: NodeJS.Timeout | null = null;
  let lastLagWarn = 0;
  let lastSentimentSec = 0;
  // First-withdrawal hold auto-promotion: one SQL UPDATE per minute. Keeps
  // the admin's "Pending" queue honest after a hold expires without needing
  // a separate scheduler process.
  let lastHoldPromoteSec = 0;
  // Affiliate daily reset: once per minute, scan for affiliate accounts whose
  // last reset date (IST) is older than today and float them back to ₹10,000.
  // Idempotent on the IST calendar day — the row-level guard inside
  // resetAffiliateAccountFloat closes the race if the engine restarts.
  let lastAffiliateResetSec = 0;
  const prevRealPrices = new Map<string, number>();

  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    const nowSec = Math.floor(startedAt / 1000);

    if (IS_CFD) {
      await desk.recoverExpiredLegacy(nowSec).catch(() => {
        logger.error({ evt: "trade.legacy_recovery_failed" }, "legacy recovery will retry next tick");
      });
    }

    if (!IS_CFD) {
      // Pre-settle pass. For buckets expiring NEXT tick, pick the resolved exit
      // price now and snap the chart to it so the user's countdown never ticks
      // through a visible shift at expiry. Sync, no DB. See TradeDesk.preSettle.
      desk.preSettle(nowSec, TICK_DT_SEC);

      // Capture exit prices before this tick moves them: a trade expiring this
      // second settles against the price its owner last saw. No awaiting here.
      desk.collectDue(nowSec);
    }

    for (const asset of registry.all()) {
      let broadcastPrice: number;
      try {
        if (IS_CFD && cfdDeps) {
          // ── CFD path ──────────────────────────────────────────────
          const { quoteBuffer, gapTracker, cfdDesk } = cfdDeps;
          const status = marketStatus(asset.symbol, quoteBuffer.latest(asset.symbol)?.ts, startedAt);
          if (status !== "open") {
            // Retain the last published value for existing expiries, but never
            // manufacture ticks/candles while the exchange is closed or stale.
            const lastPrice = registry.lastPublishedPrice(asset.symbol) || asset.state.price;
            if (lastPrice > 0) await cfdDesk.scanPositions(asset.id, asset.symbol, lastPrice, new Date(startedAt));
            continue;
          }
          const sigma = registry.sigmaNow(asset.symbol, nowSec);

          // Advance the synthetic model honestly (zero steering) so MSM
          // layers keep ticking and candle catchup on restart stays sane.
          const honestResult = registry.tick(asset.symbol, nowSec, {
            driftBias: 0,
            magnet: 0,
          });

          // Real price: live feed if available, else the honest synthetic.
          const quote = quoteBuffer.latest(asset.symbol);
          const realPrice = quote?.price ?? honestResult.price;

          // Direction of real market movement (for "never fight the trend").
          const prevReal = prevRealPrices.get(asset.symbol) ?? realPrice;
          const realMoveSign = Math.sign(realPrice - prevReal);
          prevRealPrices.set(asset.symbol, realPrice);

          // Crypto maintenance window: 4-5 AM IST frozen, 5-6 converging.
          const phase = cryptoMaintenancePhase(new Date(startedAt));
          const category = assetCategory(asset.symbol);
          const isCrypto = category === "CRYPTO";

          const marketClosed = isMarketClosed(category, new Date(startedAt));

          if ((phase === "FROZEN" && isCrypto) || marketClosed) {
            if (marketClosed) gapTracker.converge(asset.symbol, TICK_DT_SEC);
            broadcastPrice = gapTracker.shownPrice(asset.symbol, realPrice);
          } else {
            if (phase === "CONVERGING" && isCrypto) {
              gapTracker.converge(asset.symbol, TICK_DT_SEC);
            }

            // Gather open CFD positions for magnet + scan.
            const openTrades = await cfdDesk.openPositionsForAsset(asset.id);

            const magnetPositions: MagnetPosition[] = openTrades.map((t) => {
              const isLong = t.direction === "UP";
              const pnlFrac = isLong
                ? (realPrice - t.entryPrice) / t.entryPrice
                : (t.entryPrice - realPrice) / t.entryPrice;
              return {
                direction: t.direction as "UP" | "DOWN",
                stake: t.stake,
                stopLoss: t.stopLoss,
                pnlFrac,
              };
            });

            const activeUsers = new Set(openTrades.map((t) => t.accountId)).size;
            const volScale = registry.volScaleNow(asset.symbol, nowSec);

            const pull = computeMagnetPull({
              positions: magnetPositions,
              realMoveSign,
              volatility: sigma * volScale,
              sigma,
              activeUsers,
            });

            gapTracker.push(asset.symbol, pull, TICK_DT_SEC);
            const shownPrice = gapTracker.shownPrice(asset.symbol, realPrice);

            broadcastPrice = shownPrice;
          }
          // Expiry must run even while quotes are frozen or the market is closed.
          await cfdDesk.scanPositions(asset.id, asset.symbol,
            Number(broadcastPrice.toFixed(asset.precision)), new Date(startedAt));
        } else {
          // ── Binary path (unchanged) ───────────────────────────────
          const sigma = registry.sigmaNow(asset.symbol, nowSec);
          const openPositions = desk.openFor(asset.id);
          const livePositions = openPositions.filter((p) => !p.isDemo);
          const closedNow = isSymbolClosedForNight(asset.symbol, startedAt);

          const bias = 0;
          let magnetPull = 0;

          if ((USE_HOUSE_GOVERNOR || USE_GLG_TREASURY) && !closedNow) {
            const currentPrice = asset.state.price;
            const msmScale = registry.volScaleNow(asset.symbol, nowSec);
            for (const p of livePositions) {
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
              magnetPull += pb * gap * msmScale;
            }
            const cap = MAGNET_CAP * sigma;
            if (magnetPull > cap) magnetPull = cap;
            else if (magnetPull < -cap) magnetPull = -cap;
          }

          const selfAnchorTarget = SELF_ANCHOR_MODE
            ? asset.honestState.price
            : null;
          const selfAnchorAlpha = !SELF_ANCHOR_MODE
            ? 0
            : closedNow
              ? SELF_ANCHOR_ALPHA_CLOSED
              : SELF_ANCHOR_ALPHA;

          const result = registry.tick(asset.symbol, nowSec, {
            driftBias: bias,
            magnet: magnetPull,
            selfAnchorTarget,
            selfAnchorAlpha,
          });

          broadcastPrice = result.price;
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

      broadcastPrice = Number(broadcastPrice.toFixed(asset.precision));
      const closed = registry.record(asset.symbol, nowSec, broadcastPrice);

      server.broadcast(asset.symbol, {
        type: "tick",
        symbol: asset.symbol,
        price: broadcastPrice,
        ts: nowSec,
      });

      if (!IS_CFD && nowSec !== lastSentimentSec) {
        const sentiment = computeSentiment(desk.openFor(asset.id));
        server.broadcast(asset.symbol, {
          type: "sentiment",
          symbol: asset.symbol,
          ...sentiment,
        });
      }

      for (const { timeframe, candle } of closed) {
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

    // Affiliate daily float reset. Every minute: list affiliate accounts whose
    // IST reset date is stale, then reset each one back to ₹10,000. The
    // per-row guard inside resetAffiliateAccountFloat makes this idempotent
    // across restarts and concurrent engines.
    if (nowSec - lastAffiliateResetSec >= 60) {
      lastAffiliateResetSec = nowSec;
      const today = istDateOf(new Date(startedAt));
      void listAffiliateAccountsNeedingReset({ nowIstDate: today })
        .then(async (ids) => {
          if (ids.length === 0) return;
          let reset = 0;
          for (const accountId of ids) {
            try {
              const ok = await resetAffiliateAccountFloat({
                accountId,
                nowIstDate: today,
              });
              if (ok) reset += 1;
            } catch (err) {
              logger.error(
                {
                  evt: "affiliate.reset_failed",
                  accountId,
                  reason: err instanceof Error ? err.message : "unknown",
                },
                "affiliate daily reset failed for account",
              );
            }
          }
          if (reset > 0) {
            logger.info(
              { evt: "affiliate.reset", count: reset, istDate: today },
              "reset affiliate accounts to daily float",
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(
            {
              evt: "affiliate.reset_scan_failed",
              reason: err instanceof Error ? err.message : "unknown",
            },
            "affiliate reset scan failed",
          );
        });
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
