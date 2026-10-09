import { BucketRegistry, expirySecFor, type Position } from "@asm/trading";
import {
  AccountNotActive,
  AlreadySettled,
  InsufficientFunds,
  TradeNotFound,
  applySettlementToHouseDay,
  applySettlementToTreasury,
  getAccountForActor,
  getHouseDay,
  getTreasury,
  houseDateForInstant,
  isAffiliateUser,
  loadOpenPositions,
  openTrade,
  recentLossStreakStatsForAccount,
  recordSettledTrade,
  settleTrade,
  voidTrade,
  type SettledTrade,
  type ShadowInput,
} from "@asm/db";
import {
  AFFILIATE_WIN_RATE,
  FALLBACK_DAILY_TARGET_MINOR,
  HOUSE_ALWAYS_WINS_MODE,
  MAX_CORRECTIVE_TICKS,
  MAX_CORRECTIVE_TICKS_GLG,
  MAX_HONEST_TICK_SHIFT_OTC,
  USE_GLG_TREASURY,
  USE_HOUSE_GOVERNOR,
  decideVerdict,
  decideVerdictGLG,
  houseFirstWishes,
  imbalance,
  isSymbolClosedForNight,
  pickStyle,
  resolveBucket,
  TARGETS,
  type BucketWish,
} from "@asm/algo";
import {
  tradeViewFrom,
  type BalancesDto,
  type EngineOpenTradeInput,
  type OpenTradeResult,
  type ServerMessage,
  type TradeView,
} from "@asm/contracts";
import { logger } from "@asm/logger";
import type { AssetRegistry } from "../assets/registry";
import type { ControllerBridge } from "../algo/controller-bridge";
import { DeskRejection } from "./errors";

/** Reverses `desiredWinProb`'s target back to the lifecycle stage that produced
 *  it — cheaper than a second query, since `target` is copied from TARGETS
 *  verbatim and never perturbed. */
const STAGE_BY_TARGET = new Map<number, string>(
  Object.entries(TARGETS).map(([stage, target]) => [target, stage]),
);

function splitExposure(positions: readonly Position[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const position of positions) {
    const liability = (position.stake * position.payoutPct) / 100;
    if (position.direction === "UP") up += liability;
    else down += liability;
  }
  return { up, down };
}

const MAX_SETTLE_ATTEMPTS = 10;
const RETRY_BASE_MS = 500;
const STOP_TIMEOUT_MS = 5_000;

export interface Notifier {
  sendToUser(userId: string, message: ServerMessage): void;
  /**
   * Fans a message out to every subscriber of `symbol`. The desk uses this
   * to publish a settlement tick when the resolver picks an exit price that
   * differs from the shown chart the user just watched — the visual truth
   * must match the settled outcome or every trader's reaction is "my chart
   * went up but I lost".
   */
  broadcast(symbol: string, message: ServerMessage): void;
}

interface PendingSettlement {
  position: Position;
  symbol: string;
  exitPrice: number;
  honestExitPrice: number;
  resolvedExitPrice?: number;
  controllerTarget?: number;
  attempts: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Owns every open position from the moment it is opened until it settles.
 *
 * Settlement is split in two on purpose. `collectDue` runs inside the tick loop
 * and only captures prices — synchronous, no I/O, so a slow database never
 * delays a tick. A serialised worker then persists each settlement, retrying on
 * failure with the SAME captured price: retrying against a later price would
 * let an outage change who won.
 */
export class TradeDesk {
  private readonly book = new BucketRegistry();
  private readonly symbolByAssetId = new Map<string, string>();
  private readonly pending: PendingSettlement[] = [];
  private draining: Promise<void> | null = null;
  /**
   * Pre-settle fix (2026-10-05). Tracks buckets whose chart has already been
   * snapped to the resolver's picked exit price one tick before expiry, so
   * `collectDue` can skip the async resolver and settle immediately. Keyed
   * by `symbol|expirySec` to survive the pre→collect gap even if the clock
   * advances through more than one bucket boundary in a single run.
   */
  private readonly preResolvedByBucket = new Map<string, number>();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly notifier: Notifier,
    private readonly controller: ControllerBridge,
    private readonly now: () => number = Date.now,
  ) {
    for (const asset of assets.all()) this.symbolByAssetId.set(asset.id, asset.symbol);
  }

  async open(input: EngineOpenTradeInput): Promise<OpenTradeResult> {
    const asset = this.assets.get(input.symbol);
    if (!asset) throw new DeskRejection("unknown_asset");

    // Phase 2D: refuse new opens on India-market symbols during the nightly
    // close window (23:30–05:00 IST). Crypto and forex are 24/7 and never
    // observe this close. Existing trades keep settling at their natural
    // expiry inside the window (Q11) — this check is on the OPEN path only.
    if (isSymbolClosedForNight(asset.symbol, this.now())) {
      throw new DeskRejection("market_closed");
    }

    // Defence in depth: the web app checked ownership, and so does the engine.
    const account = await getAccountForActor(input.actorId, input.accountId);
    if (!account) throw new DeskRejection("account_not_found");

    // Affiliate flag — drives the governor bypass below and the HouseDay /
    // HouseTreasury skip at settlement. One extra read on the open path;
    // the result is also stamped on the Position so settlement doesn't
    // re-check. See docs/superpowers/specs/2026-10-08-affiliate-accounts-design.md.
    const isAffiliate = await isAffiliateUser(account.userId);

    // Price, entry time and expiry are captured together, here.
    const entryTs = new Date(this.now());
    const expiryTs = new Date(entryTs.getTime() + input.durationSec * 1000);
    const entryPrice = Number(asset.state.price.toFixed(asset.precision));

    // House-governor stamps. Off by default — when the flag is on the verdict
    // is decided at OPEN time and the tick loop's per-trade magnet steers the
    // shown price toward the outcome across the full duration. Demo trades
    // resolve HONEST under the v2 governor; under GLG they roll a fixed
    // DEMO_WIN_RATE WIN/LOSS (ignored by ledger either way). On failure to
    // read the ledger we fall through to HONEST (fail-safe: no bias applied).
    let governorStamp: {
      verdict: "WIN" | "LOSS" | "HONEST";
      pathStyle: "DIRECT" | "OSCILLATE" | "FEINT";
      targetPrice: number;
    } | null = null;
    if (USE_HOUSE_GOVERNOR || USE_GLG_TREASURY || isAffiliate) {
      try {
        const isDemo = account.type === "DEMO";
        let verdict: "WIN" | "LOSS" | "HONEST";
        if (isAffiliate) {
          // Affiliate path: skip the GLG governor and the treasury read.
          // LIVE trades roll AFFILIATE_WIN_RATE (80%) WIN; DEMO trades
          // stay HONEST (same as any user's demo). The value-imbalance
          // override below still runs so an affiliate's WIN stamp doesn't
          // ruin another user's heavier-side bucket. HouseDay/HouseTreasury
          // writes are skipped at settlement (see drain()).
          verdict = isDemo
            ? "HONEST"
            : Math.random() < AFFILIATE_WIN_RATE
              ? "WIN"
              : "LOSS";
        } else {
          // GLG RETIRE 2026-10-05 — the v2 (daily-ladder) governor branch that
          // ran when USE_GLG_TREASURY was off is commented out below. GLG is
          // now the sole open-time verdict path; the USE_HOUSE_GOVERNOR flag
          // is retained only so a trade reaches this block, which is harmless
          // when GLG is on. See algorithm.md Phase 3.
          let treasuryMinor = 0;
          let treasuryTargetMinor = FALLBACK_DAILY_TARGET_MINOR;
          if (!isDemo) {
            const treasury = await getTreasury();
            if (treasury) {
              treasuryMinor = treasury.treasuryMinor;
              treasuryTargetMinor = treasury.treasuryTargetMinor;
            }
          }
          verdict = decideVerdictGLG(
            {
              isDemo,
              treasuryMinor,
              treasuryTargetMinor,
              tradeStakeMinor: input.stake,
              tradePayoutPct: asset.payoutPct,
            },
            Math.random,
          );
        }

        /*
         * // GLG RETIRE — pre-GLG v2 (daily-ladder) governor. DO NOT
         * // reactivate without reviewing why GLG replaced the time-based
         * // ladder (algorithm.md Phase 3).
         * let dailyTargetMinor = FALLBACK_DAILY_TARGET_MINOR;
         * let realizedTodayMinor = 0;
         * let userLossStreak = 0;
         * let userLossStreakStakeMinor = 0;
         * if (!isDemo) {
         *   const today = houseDateForInstant(entryTs);
         *   const [ledger, streakStats] = await Promise.all([
         *     getHouseDay(today),
         *     recentLossStreakStatsForAccount(input.accountId),
         *   ]);
         *   if (ledger) {
         *     dailyTargetMinor = ledger.targetProfitMinor;
         *     realizedTodayMinor = ledger.realizedProfitMinor;
         *   }
         *   userLossStreak = streakStats.count;
         *   userLossStreakStakeMinor = streakStats.totalStakeMinor;
         * }
         * const istMs = entryTs.getTime() + 5.5 * 3_600_000;
         * const istInstant = new Date(istMs);
         * const istDayEnd = Date.UTC(
         *   istInstant.getUTCFullYear(),
         *   istInstant.getUTCMonth(),
         *   istInstant.getUTCDate() + 1,
         * );
         * const minutesUntilDayEnd = Math.max(
         *   0,
         *   Math.round((istDayEnd - istMs) / 60_000),
         * );
         * verdict = decideVerdict({
         *   isDemo, dailyTargetMinor, realizedTodayMinor,
         *   userLossStreak, userLossStreakStakeMinor,
         *   userIsHighValue: false,
         *   tradeStakeMinor: input.stake,
         *   tradePayoutPct: asset.payoutPct,
         *   minutesUntilDayEnd,
         * }, Math.random);
         */

        // Open-time value-imbalance override (2026-10-05, option (a)).
        // Settlement-time force-LOSS alone can be defeated by natural GARCH
        // drift when the chart has already moved past the 10-tick corrective
        // window by expiry. The per-trade magnet uses the stamped verdict's
        // targetPrice for the whole trade duration, so a heavy-side WIN
        // stamp actively PULLS the chart toward its target — then
        // settlement rescue can't fight both the drift and the magnet.
        //
        // Fix: at open, peek the current bucket (same asset + expirySec).
        // If joining this trade makes its direction the heavier side AND
        // there is already a counter-direction trade in the bucket, flip a
        // WIN verdict to LOSS so the magnet steers against this trade for
        // the full duration. Demos are excluded (they never contribute to
        // the live chart). HONEST stamps also pass through unchanged.
        if (!isDemo && verdict === "WIN") {
          const bucketExpirySec = expirySecFor(expiryTs.getTime());
          const existing = this.book.positionsAt(asset.id, bucketExpirySec);
          let upStake = 0;
          let downStake = 0;
          for (const p of existing) {
            if (p.isDemo) continue;
            if (p.verdict == null || p.verdict === "HONEST") continue;
            if (p.direction === "UP") upStake += p.stake;
            else downStake += p.stake;
          }
          const futureMyDir =
            input.direction === "UP"
              ? upStake + input.stake
              : downStake + input.stake;
          const futureOtherDir =
            input.direction === "UP" ? downStake : upStake;
          if (futureMyDir > futureOtherDir && futureOtherDir > 0) {
            logger.info(
              {
                evt: "glg.open_value_imbalance_override",
                symbol: asset.symbol,
                direction: input.direction,
                bucketExpirySec,
                futureMyDir,
                futureOtherDir,
              },
              "flipped WIN → LOSS at open to protect the heavier side",
            );
            verdict = "LOSS";
          }
        }

        const pathStyle = pickStyle(input.durationSec, verdict, Math.random);

        // Target price: for WIN we want the user's side, for LOSS the house side.
        // For UP direction: user wins if price rises → LOSS target is below entry.
        // For DOWN direction: user wins if price falls → LOSS target is above entry.
        // HONEST: no target used but we stamp entryPrice as a harmless default.
        const tick = asset.tickSize;
        const userWins =
          verdict === "WIN" ||
          (verdict === "HONEST" && input.direction === "UP");
        let target: number;
        if (verdict === "HONEST") {
          target = entryPrice;
        } else if (input.direction === "UP") {
          target = userWins ? entryPrice + tick : entryPrice - tick;
        } else {
          target = userWins ? entryPrice - tick : entryPrice + tick;
        }

        governorStamp = { verdict, pathStyle, targetPrice: target };
      } catch (err) {
        logger.warn(
          {
            evt: "trade.governor_stamp_failed",
            reason: err instanceof Error ? err.message : "unknown",
          },
          "governor stamp failed — proceeding without a verdict",
        );
      }
    }

    let opened;
    try {
      opened = await openTrade({
        accountId: input.accountId,
        assetId: asset.id,
        direction: input.direction,
        stake: input.stake,
        payoutPct: asset.payoutPct,
        entryPrice,
        entryTs,
        expiryTs,
        ...(governorStamp
          ? {
              verdict: governorStamp.verdict,
              pathStyle: governorStamp.pathStyle,
              targetPrice: governorStamp.targetPrice,
            }
          : {}),
      });
    } catch (err) {
      if (err instanceof InsufficientFunds) throw new DeskRejection("insufficient_funds");
      if (err instanceof AccountNotActive) throw new DeskRejection("account_not_active");
      throw err;
    }

    // No await between this check and book.add, so no tick can collect the
    // bucket in between. A write that outlasted the trade has no price from its
    // expiry second to settle against, so it is voided like an outage.
    const expirySec = expirySecFor(expiryTs.getTime());
    if (expirySec <= Math.floor(this.now() / 1000)) {
      const voided = await voidTrade(opened.trade.id);
      // Invalidate the cached controller wish for this account. The refund
      // doesn't move stats today, but the settle path invalidates too and
      // this keeps the two paths in lock-step — one silent divergence away
      // from a stale-wish bug in a future change.
      this.controller.invalidate(input.accountId);
      logger.warn(
        { evt: "trade.open_expired_in_flight", tradeId: opened.trade.id, symbol: asset.symbol },
        "trade expired before its write completed — voided",
      );
      this.announce(voided, asset.symbol);
      return {
        trade: tradeViewFrom(voided.trade, asset.symbol),
        balances: { realBalance: voided.realBalance, bonusBalance: voided.bonusBalance },
      };
    }

    this.book.add({
      tradeId: opened.trade.id,
      accountId: opened.trade.accountId,
      assetId: asset.id,
      direction: opened.trade.direction,
      stake: opened.trade.stake,
      payoutPct: opened.trade.payoutPct,
      entryPrice,
      entrySec: Math.floor(entryTs.getTime() / 1000),
      expirySec,
      isDemo: account.type === "DEMO",
      isAffiliate,
      ...(governorStamp
        ? {
            verdict: governorStamp.verdict,
            pathStyle: governorStamp.pathStyle,
            targetPrice: governorStamp.targetPrice,
          }
        : {}),
    });

    const result: OpenTradeResult = {
      trade: tradeViewFrom(opened.trade, asset.symbol),
      balances: { realBalance: opened.realBalance, bonusBalance: opened.bonusBalance },
    };
    this.notify(input.actorId, "trade:opened", result.trade, result.balances);

    logger.info(
      { evt: "trade.opened", tradeId: result.trade.id, symbol: asset.symbol, direction: input.direction, stake: input.stake },
      "trade opened",
    );
    return result;
  }

  /**
   * Reloads open positions after a restart. Positions expiring after `nowSec`
   * rejoin the book; the rest are voided. A restart resets every asset's price,
   * so there is no recorded price for an expiry at or before the restart second.
   */
  async hydrate(nowSec: number): Promise<void> {
    const positions = await loadOpenPositions();
    let voided = 0;

    for (const position of positions) {
      if (position.expirySec > nowSec) {
        this.book.add(position);
        continue;
      }
      try {
        const settled = await voidTrade(position.tradeId);
        this.controller.invalidate(position.accountId);
        voided += 1;
        this.announce(settled, this.symbolByAssetId.get(position.assetId) ?? "UNKNOWN");
      } catch (err) {
        if (!(err instanceof AlreadySettled)) throw err;
      }
    }

    logger.info(
      { evt: "engine.book_hydrated", open: this.book.size(), voided },
      "trade book hydrated",
    );
  }

  /**
   * Pre-settle pass (2026-10-05). Runs at the start of every tick with
   * `nowSec = tickNowSec`. For buckets expiring at `nowSec + TICK_DT_SEC`
   * (next tick) we compute the resolver's picked exit price NOW and snap
   * `asset.state.price` to it. The result:
   *   - The chart broadcast for THIS tick already shows the final price.
   *   - When nowSec reaches expirySec next tick, `collectDue` picks up a
   *     chart that already matches the eventual settled exit — no visible
   *     shift, and the drain just writes to the DB without broadcasting a
   *     correction tick.
   *
   * Sync (no awaits, no DB). Uses `book.peekRange` so the bucket stays in
   * place for the real `collectDue` next tick.
   */
  preSettle(nowSec: number, tickDtSec: number): void {
    const preExpirySec = nowSec + tickDtSec;
    const buckets = this.book.peekRange(preExpirySec, preExpirySec);
    for (const bucket of buckets) {
      const symbol = this.symbolByAssetId.get(bucket.assetId);
      const asset = symbol ? this.assets.get(symbol) : undefined;
      if (!asset || !symbol) continue;

      const liveStamped = bucket.positions.filter(
        (p) =>
          !p.isDemo &&
          p.verdict != null &&
          p.verdict !== "HONEST",
      );
      if (liveStamped.length === 0) continue;

      let upStake = 0;
      let downStake = 0;
      for (const p of liveStamped) {
        if (p.direction === "UP") upStake += p.stake;
        else downStake += p.stake;
      }
      const forcedLossDir: "UP" | "DOWN" | null =
        upStake > 0 && downStake > 0
          ? upStake > downStake
            ? "UP"
            : downStake > upStake
              ? "DOWN"
              : null
          : null;

      const wishes: BucketWish[] = liveStamped.map((p) => {
        const forcedLoss =
          forcedLossDir !== null && p.direction === forcedLossDir;
        const wantWin = forcedLoss ? false : p.verdict === "WIN";
        return {
          entryPrice: p.entryPrice,
          direction: p.direction,
          wantWin,
          urgency: 10,
          stake: p.stake,
          payoutPct: p.payoutPct,
        };
      });

      const currentPrice = Number(asset.state.price.toFixed(asset.precision));
      const honestPrice = this.assets.honestPrice(symbol);
      const resolvedPrice = resolveBucket({
        wishes,
        currentPrice,
        maxMove: asset.tickSize * MAX_CORRECTIVE_TICKS_GLG,
        tickSize: asset.tickSize,
        honestPrice,
        maxHonestShift: MAX_HONEST_TICK_SHIFT_OTC,
      });

      asset.state = { ...asset.state, price: resolvedPrice };
      this.preResolvedByBucket.set(
        `${symbol}|${bucket.expirySec}`,
        resolvedPrice,
      );
    }
  }

  /** Called from the tick loop. Captures one price per due bucket; never awaits. */
  collectDue(nowSec: number): void {
    for (const bucket of this.book.due(nowSec)) {
      const symbol = this.symbolByAssetId.get(bucket.assetId);
      const asset = symbol ? this.assets.get(symbol) : undefined;
      if (!asset || !symbol) {
        logger.error(
          { evt: "trade.settle_no_asset", assetId: bucket.assetId, positions: bucket.positions.length },
          "cannot settle — asset not loaded; positions stay OPEN until the next restart voids them",
        );
        continue;
      }

      const bucketKey = `${symbol}|${bucket.expirySec}`;
      // We no longer READ preResolved to settle live trades — the chart is
      // the source of truth now (see below) — but still clear the cache so
      // it doesn't leak forever. preSettle keeps writing it; the value is
      // only used as a chart-aesthetic snap one tick before expiry.
      this.preResolvedByBucket.delete(bucketKey);
      // exitPrice is `asset.state.price` at the start of THIS tick, i.e. the
      // final close broadcast at the end of LAST tick — the number the user
      // saw on their chart when the countdown hit zero. Previously we
      // preferred preSettle's resolver pick from last tick, but stepPrice +
      // commitSnap on that same tick moved the shown price AWAY from the
      // resolver pick toward the stamped trade's own targetPrice, so the DB
      // settled at one price while the user watched another — "clear WIN on
      // the chart, LOST on my account". Trusting the chart ends that
      // divergence by construction. The stamped verdict still steers the
      // outcome because the magnet + commitSnap have already pulled the
      // chart to the trade's targetPrice by the time this tick runs.
      const exitPrice = Number(asset.state.price.toFixed(asset.precision));
      const honestExitPrice = this.assets.honestPrice(symbol);
      for (const position of bucket.positions) {
        const pending: PendingSettlement = {
          position,
          symbol,
          exitPrice,
          honestExitPrice,
          attempts: 0,
        };

        // Demo isolation (Option B, 2026-10-05). Demos never contribute to
        // the shown chart (the tick loop already filters them out of the
        // magnet). At settlement, instead of inheriting the shared bucket
        // exit, each demo gets its own exitPrice from the GLG stamp so the
        // user-visible outcome matches DEMO_WIN_RATE exactly:
        //   WIN  → exitPrice = targetPrice (favors user's direction)
        //   LOSS → exitPrice = targetPrice (against user's direction)
        // The targetPrice was set at open based on (verdict × direction),
        // so writing it back as exitPrice makes WIN/LOSS deterministic.
        // Marking `resolvedExitPrice` here means the bucket resolver skips
        // this item — demos never share a resolved price with live trades.
        if (
          position.isDemo &&
          position.verdict != null &&
          position.verdict !== "HONEST" &&
          position.targetPrice !== undefined
        ) {
          pending.resolvedExitPrice = Number(
            position.targetPrice.toFixed(asset.precision),
          );
        } else {
          // Live (or honest-grandfathered) trade — the chart IS the exit.
          // Skip the drain-time bucket resolver entirely so no later pass
          // can rewrite exitPrice to something the user never saw.
          pending.resolvedExitPrice = exitPrice;
        }

        this.pending.push(pending);
      }
    }

    if (this.pending.length > 0 && !this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
  }

  openFor(assetId: string): Position[] {
    return this.book.openFor(assetId);
  }

  /** Resolves once every captured settlement has been persisted or abandoned. */
  idle(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  async stop(): Promise<void> {
    await Promise.race([this.idle(), sleep(STOP_TIMEOUT_MS)]);
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      // Resolve bucket exit prices for any unresolved items before settling.
      // Items sharing the same bucket (symbol + captured exitPrice) get ONE
      // shared resolved price so that co-expiring positions are consistent.
      await this.resolveUnresolvedBuckets();

      const item = this.pending[0]!;
      let settled: SettledTrade;
      try {
        const shadow = this.buildShadow(item);
        settled = await settleTrade({
          tradeId: item.position.tradeId,
          exitPrice: item.resolvedExitPrice!,
          shadow,
        });
      } catch (err) {
        // Nothing left to settle: retrying either would only stall the queue.
        if (err instanceof AlreadySettled || err instanceof TradeNotFound) {
          this.pending.shift();
          continue;
        }
        item.attempts += 1;
        logger.error(
          {
            evt: "trade.settle_failed",
            tradeId: item.position.tradeId,
            attempt: item.attempts,
            reason: err instanceof Error ? err.message : "unknown",
          },
          "settlement failed — retrying with the same captured price",
        );
        if (item.attempts >= MAX_SETTLE_ATTEMPTS) {
          this.pending.shift();
          logger.error(
            { evt: "trade.settle_abandoned", tradeId: item.position.tradeId },
            "settlement abandoned — trade left OPEN; the next engine start will void it",
          );
          continue;
        }
        await sleep(RETRY_BASE_MS * item.attempts);
        continue;
      }
      this.pending.shift();

      // Best-effort: the money has already moved, so a stats-update failure
      // must never roll the settlement back or retry it.
      if (settled.trade.status !== "OPEN") {
        await recordSettledTrade({
          accountId: item.position.accountId,
          stake: item.position.stake,
          outcome: settled.trade.status,
        }).catch((err: unknown) => {
          logger.error(
            {
              evt: "trade.stats_update_failed",
              tradeId: item.position.tradeId,
              reason: err instanceof Error ? err.message : "unknown",
            },
            "account stats update failed after settlement",
          );
        });

        // Governor ledgers. Live only — demo trades never move them, and
        // affiliate trades are play money that must not distort house
        // economics (daily float resets at 00:00 IST, nothing is really
        // owed). Both writes are best-effort; a failed upsert must not
        // roll the settlement back. We dual-write during the GLG rollout
        // so admin reporting keeps its daily breakdown AND the treasury
        // keeps accumulating even when USE_GLG_TREASURY is toggled off.
        if (
          (USE_HOUSE_GOVERNOR || USE_GLG_TREASURY) &&
          !item.position.isDemo &&
          !item.position.isAffiliate
        ) {
          const settledAt = settled.trade.expiryTs ?? new Date(this.now());
          await applySettlementToHouseDay({
            date: houseDateForInstant(settledAt),
            fallbackTargetMinor: FALLBACK_DAILY_TARGET_MINOR,
            userPnl: settled.trade.pnl,
            stake: item.position.stake,
            outcome: settled.trade.status,
          }).catch((err: unknown) => {
            logger.error(
              {
                evt: "trade.house_day_update_failed",
                tradeId: item.position.tradeId,
                reason: err instanceof Error ? err.message : "unknown",
              },
              "HouseDay ledger update failed after settlement",
            );
          });

          await applySettlementToTreasury({
            stake: item.position.stake,
            payoutPct: item.position.payoutPct,
            outcome: settled.trade.status,
            fallbackTargetMinor: FALLBACK_DAILY_TARGET_MINOR,
          }).catch((err: unknown) => {
            logger.error(
              {
                evt: "trade.house_treasury_update_failed",
                tradeId: item.position.tradeId,
                reason: err instanceof Error ? err.message : "unknown",
              },
              "HouseTreasury ledger update failed after settlement",
            );
          });
        }
      }
      this.controller.invalidate(item.position.accountId);

      this.announce(settled, item.symbol);
    }
  }

  /**
   * Groups unresolved pending items by bucket (same symbol + captured exit
   * price), gathers per-account controller wishes, then calls `resolveBucket`
   * once per group so co-expiring positions share a single resolved exit price.
   */
  private async resolveUnresolvedBuckets(): Promise<void> {
    // ── Pre-pass: same-time value-imbalanced house protection ──────────────
    // Group pending live GLG-stamped trades by (symbol, expirySec). Inside
    // each such contest, if BOTH directions have live trades AND aggregate
    // stakes differ, the higher-stake direction must lose the bucket — a
    // single big win on the heavier side would drain the treasury by more
    // than the lighter side ever put at risk. Solo users are untouched
    // (their side has no counterparty). Marks each item with a boolean the
    // wish-building block honors.
    const forcedLossByTradeId = new Map<string, boolean>();
    if (USE_GLG_TREASURY) {
      const contests = new Map<
        string,
        { upStake: number; downStake: number; items: PendingSettlement[] }
      >();
      for (const item of this.pending) {
        if (item.resolvedExitPrice !== undefined) continue;
        if (item.position.isDemo) continue;
        if (
          item.position.verdict == null ||
          item.position.verdict === "HONEST"
        ) {
          continue;
        }
        const key = `${item.symbol}:${item.position.expirySec}`;
        let c = contests.get(key);
        if (!c) {
          c = { upStake: 0, downStake: 0, items: [] };
          contests.set(key, c);
        }
        if (item.position.direction === "UP") c.upStake += item.position.stake;
        else c.downStake += item.position.stake;
        c.items.push(item);
      }
      for (const [, c] of contests) {
        if (c.upStake === 0 || c.downStake === 0) continue;
        const losingDir: "UP" | "DOWN" | null =
          c.upStake > c.downStake
            ? "UP"
            : c.downStake > c.upStake
              ? "DOWN"
              : null;
        if (losingDir === null) continue;
        for (const it of c.items) {
          if (it.position.direction === losingDir) {
            forcedLossByTradeId.set(it.position.tradeId, true);
          }
        }
      }
    }

    const groups = new Map<string, PendingSettlement[]>();
    for (const item of this.pending) {
      if (item.resolvedExitPrice !== undefined) continue;
      // Share the bucket across all co-expiring trades on the same asset so
      // every viewer sees the same chart tick at settlement — the snap on
      // line ~745 fires ONCE per bucket. Isolating per-trade would let each
      // user's own bucket snap the chart to a different price in sequence,
      // producing a visible jitter for all watchers. Solo users still get
      // their own bucket naturally (one trade in the group). Multi-user
      // contests share one bucket; value-imbalance protection above tilts
      // the resolver toward the direction that hurts the heavier-stake side.
      const key = `${item.symbol}:${item.exitPrice}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(item);
    }

    for (const [, group] of groups) {
      const first = group[0]!;
      const asset = this.assets.get(first.symbol);
      if (!asset) {
        throw new Error(`resolveUnresolvedBuckets: unknown symbol "${first.symbol}"`);
      }

      let wishes: BucketWish[];
      // Governor-first path: when a per-trade verdict was stamped at open
      // time (v2 House Governor or GLG), the settlement resolver honors it
      // per-user instead of picking a losing side by aggregate stake.
      // Without this branch, `houseFirstWishes` forces every single-user
      // bucket to lose (upLiability > 0, downLiability = 0 → user's side
      // loses), silently overriding every WIN verdict. HONEST verdicts run
      // with zero urgency so the resolver leaves the honest price alone.
      const anyGovernor = USE_HOUSE_GOVERNOR || USE_GLG_TREASURY;
      const stampedGroup =
        anyGovernor &&
        group.every(
          (item) =>
            item.position.isDemo ||
            (item.position.verdict !== undefined &&
              item.position.verdict !== null),
        );
      if (stampedGroup) {
        wishes = [];
        for (const item of group) {
          const p = item.position;
          const verdict = p.verdict;
          const isHonest = p.isDemo || verdict === "HONEST" || verdict == null;
          // Same-time value-imbalance override: if this trade sits on the
          // heavier direction of a live GLG contest, force LOSS regardless
          // of the stamped verdict. Solo trades and lighter-side trades
          // keep their stamped verdict.
          const forcedLoss = forcedLossByTradeId.get(p.tradeId) === true;
          const wantWin = forcedLoss ? false : verdict === "WIN";
          wishes.push({
            entryPrice: p.entryPrice,
            direction: p.direction,
            wantWin,
            urgency: isHonest ? 0 : 10,
            stake: p.stake,
            payoutPct: p.payoutPct,
          });
          item.controllerTarget = -1;
        }
      } else {
        // GLG RETIRE 2026-10-05 — the two pre-GLG settlement branches that
        // used to live here (HOUSE_ALWAYS_WINS_MODE aggregate-liability
        // resolver, and the legacy per-user Bayesian controller) are
        // commented out below. GLG stamps every non-demo trade at open and
        // demo trades roll a HONEST verdict, so by the time control reaches
        // here `stampedGroup` is true in every path we still support. If
        // it's false, something upstream failed to stamp — treat the whole
        // group as HONEST (zero urgency, resolver leaves honest price
        // alone) rather than silently reactivating a retired algo.
        wishes = group.map((item) => ({
          entryPrice: item.position.entryPrice,
          direction: item.position.direction,
          wantWin: false,
          urgency: 0,
          stake: item.position.stake,
          payoutPct: item.position.payoutPct,
        }));
        for (const item of group) {
          item.controllerTarget = -1;
        }
        logger.warn(
          {
            evt: "settle.unstamped_group_fallback",
            symbol: first.symbol,
            size: group.length,
          },
          "settlement group had no verdict stamps — resolving as HONEST",
        );

        /*
         * // GLG RETIRE — pre-GLG settlement paths. DO NOT reactivate without
         * // reviewing the chart-wick behaviour the GLG shrink of 2026-10-05
         * // was fixing (see algorithm.md Phase 3).
         *
         * else if (HOUSE_ALWAYS_WINS_MODE) {
         *   // Deterministic per-bucket wishes derived from the aggregate
         *   // money at stake — no per-user controller draw, no probability.
         *   // Whichever side has more real-money liability loses, subject
         *   // only to the undetectability cap enforced by resolveBucket.
         *   const liveOnly = group
         *     .filter((item) => !item.position.isDemo)
         *     .map((item) => item.position);
         *   const expirySec = group[0]!.position.expirySec;
         *   const outcome = houseFirstWishes(
         *     liveOnly.length > 0 ? liveOnly : group.map((item) => item.position),
         *     `${asset.id}|${expirySec}`,
         *   );
         *   wishes = outcome.wishes;
         *   for (const item of group) {
         *     item.controllerTarget = -1;
         *   }
         * } else {
         *   // Legacy per-user Bayesian controller.
         *   wishes = [];
         *   for (const item of group) {
         *     const { wantWin, urgency, output } = await this.controller.wishFor(
         *       item.position.accountId,
         *     );
         *     wishes.push({
         *       entryPrice: item.position.entryPrice,
         *       direction: item.position.direction,
         *       wantWin,
         *       urgency,
         *       stake: item.position.stake,
         *       payoutPct: item.position.payoutPct,
         *     });
         *     item.controllerTarget = output.target;
         *   }
         * }
         */
      }

      // Every market runs GLG — no external reference. MAX_HONEST_TICK_SHIFT_OTC
      // (200 ticks) applies as the absolute cap on how far the resolver may
      // move the chart away from the honest path, bounding absurd single-tick
      // spikes. The GLG corrective-window cap above is much tighter and is
      // the one that governs the normal case.
      const maxHonestShift = MAX_HONEST_TICK_SHIFT_OTC;

      // Under GLG, the per-trade tick-blend may have fought against other
      // co-open trades' targets, so currentPrice at expiry can be a few
      // ticks away from THIS trade's target. The resolver gets a bounded
      // corrective window (MAX_CORRECTIVE_TICKS_GLG = 10) to rescue the
      // stamped verdict without the big single-tick wick the old
      // MAX_HONEST_TICK_SHIFT_OTC (200) was leaving on the 1M chart.
      // Verdicts that fall outside this window settle at the honest price;
      // GLG's pWin ≤ 0.5 keeps house edge positive on honest resolution.
      const glgIsolated = stampedGroup && USE_GLG_TREASURY;
      const correctiveTicks = glgIsolated
        ? MAX_CORRECTIVE_TICKS_GLG
        : MAX_CORRECTIVE_TICKS;

      const resolvedPrice = resolveBucket({
        wishes,
        currentPrice: first.exitPrice,
        maxMove: asset.tickSize * correctiveTicks,
        tickSize: asset.tickSize,
        ...(maxHonestShift != null && {
          honestPrice: first.honestExitPrice,
          maxHonestShift,
        }),
      });

      for (const item of group) {
        item.resolvedExitPrice = resolvedPrice;
      }

      // UX consistency: the shown chart the user just watched (`first.exitPrice`)
      // may differ from what the resolver picked (`resolvedPrice`) — the
      // resolver is free to pick any candidate inside its reachable window,
      // including `entryPrice ± tickSize` and `honestPrice`. Under house-first
      // mode that gap can literally cross entry (e.g. shown was 23,764 above
      // entry 23,760 so a BUY looked like a win, but resolvedPrice snapped to
      // 23,759 to make BUY lose). Without a correction, the user's chart said
      // "won" while the settlement said "lost" — the exact bug reported. Snap
      // the shown state to the resolved price and publish a tick so every
      // watcher sees the chart complete the move. The next tick continues
      // naturally from the corrected price.
      const roundedResolved = Number(
        resolvedPrice.toFixed(asset.precision),
      );
      const roundedShown = Number(first.exitPrice.toFixed(asset.precision));
      if (roundedResolved !== roundedShown) {
        asset.state = { ...asset.state, price: resolvedPrice };
        this.notifier.broadcast(first.symbol, {
          type: "tick",
          symbol: first.symbol,
          price: roundedResolved,
          ts: Math.floor(this.now() / 1000),
        });
      }
    }
  }

  /** Builds the shadow-ledger record for a single position after its bucket
   *  has been resolved. Both exit prices were captured synchronously in
   *  `collectDue`, so the counterfactual comparison is tick-matched. */
  private buildShadow(item: PendingSettlement): ShadowInput {
    const nowSec = Math.floor(this.now() / 1000);
    const openPositions = this.book.openFor(item.position.assetId);
    const imbalanceNow = imbalance(openPositions, nowSec);
    const { up, down } = splitExposure(openPositions);
    const target = item.controllerTarget;

    return {
      honestExitPrice: item.honestExitPrice,
      biasApplied: item.resolvedExitPrice! - item.exitPrice,
      magnetApplied: 0,
      imbalanceAtEntry: imbalanceNow,
      exposureUp: up,
      exposureDown: down,
      lifecycleStage: target !== undefined
        ? (STAGE_BY_TARGET.get(target) ?? "UNKNOWN")
        : "UNKNOWN",
    };
  }

  private announce(settled: SettledTrade, symbol: string): void {
    const trade = tradeViewFrom(settled.trade, symbol);
    this.notify(settled.userId, "trade:settled", trade, {
      realBalance: settled.realBalance,
      bonusBalance: settled.bonusBalance,
    });
    logger.info(
      { evt: "trade.settled", tradeId: trade.id, status: trade.status, pnl: trade.pnl },
      "trade settled",
    );
  }

  private notify(
    userId: string,
    type: "trade:opened" | "trade:settled",
    trade: TradeView,
    balances: BalancesDto,
  ): void {
    // The money has already moved; a failed push must never undo or retry that.
    try {
      this.notifier.sendToUser(
        userId,
        type === "trade:opened" ? { type: "trade:opened", trade } : { type: "trade:settled", trade },
      );
      this.notifier.sendToUser(userId, { type: "balance:update", accountId: trade.accountId, ...balances });
    } catch (err) {
      logger.error(
        { evt: "trade.notify_failed", tradeId: trade.id, reason: err instanceof Error ? err.message : "unknown" },
        "trade notification failed",
      );
    }
  }
}
