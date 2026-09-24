import { BucketRegistry, expirySecFor, type Position } from "@asm/trading";
import {
  AccountNotActive,
  AlreadySettled,
  InsufficientFunds,
  TradeNotFound,
  getAccountForActor,
  loadOpenPositions,
  openTrade,
  recordSettledTrade,
  settleTrade,
  voidTrade,
  type SettledTrade,
  type ShadowInput,
} from "@asm/db";
import {
  HOUSE_ALWAYS_WINS_MODE,
  MAX_HONEST_TICK_SHIFT_OTC,
  houseFirstWishes,
  imbalance,
  isSymbolClosedForNight,
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

    // Price, entry time and expiry are captured together, here.
    const entryTs = new Date(this.now());
    const expiryTs = new Date(entryTs.getTime() + input.durationSec * 1000);
    const entryPrice = Number(asset.state.price.toFixed(asset.precision));

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
      expirySec,
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

      const exitPrice = Number(asset.state.price.toFixed(asset.precision));
      const honestExitPrice = this.assets.honestPrice(symbol);
      for (const position of bucket.positions) {
        this.pending.push({ position, symbol, exitPrice, honestExitPrice, attempts: 0 });
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
    const groups = new Map<string, PendingSettlement[]>();
    for (const item of this.pending) {
      if (item.resolvedExitPrice !== undefined) continue;
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
      if (HOUSE_ALWAYS_WINS_MODE) {
        // House-first path. Deterministic per-bucket wishes derived from the
        // aggregate money at stake — no per-user controller draw, no
        // probability. Whichever side has more real-money liability loses,
        // subject only to the undetectability cap enforced by resolveBucket.
        //
        // The tie-break seed pins any coin-flip to the bucket identity, so
        // an audit re-run against the same (symbol, expirySec) reproduces
        // the same outcome.
        const positions = group.map((item) => item.position);
        const expirySec = group[0]!.position.expirySec;
        const outcome = houseFirstWishes(positions, `${asset.id}|${expirySec}`);
        wishes = outcome.wishes;
        for (const item of group) {
          // Streak counters and the shadow ledger still get "controllerTarget"
          // for continuity; house-first mode records a sentinel value so
          // downstream tooling can tell the two paths apart.
          item.controllerTarget = -1;
        }
      } else {
        wishes = [];
        for (const item of group) {
          const { wantWin, urgency, output } = await this.controller.wishFor(
            item.position.accountId,
          );
          wishes.push({
            entryPrice: item.position.entryPrice,
            direction: item.position.direction,
            wantWin,
            urgency,
            stake: item.position.stake,
            payoutPct: item.position.payoutPct,
          });
          item.controllerTarget = output.target;
        }
      }

      // Every market runs the full-authority house-first algo — the
      // catalogue is 18 house-first assets, none anchor to an external
      // reference. MAX_HONEST_TICK_SHIFT_OTC (200 ticks) applies uniformly,
      // bounding absurd single-tick spikes without letting the "windows
      // don't intersect" edge case strand the resolver.
      const maxHonestShift = HOUSE_ALWAYS_WINS_MODE
        ? MAX_HONEST_TICK_SHIFT_OTC
        : undefined;

      const resolvedPrice = resolveBucket({
        wishes,
        currentPrice: first.exitPrice,
        maxMove: asset.params.maxTickMove,
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
