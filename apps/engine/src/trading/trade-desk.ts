import { BucketRegistry, expirySecFor, type Position } from "@asm/trading";
import {
  AlreadySettled,
  InsufficientFunds,
  TradeNotFound,
  getAccountForActor,
  loadOpenPositions,
  openTrade,
  settleTrade,
  voidTrade,
  type SettledTrade,
} from "@asm/db";
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
import { DeskRejection } from "./errors";

const MAX_SETTLE_ATTEMPTS = 10;
const RETRY_BASE_MS = 500;
const STOP_TIMEOUT_MS = 5_000;

export interface Notifier {
  sendToUser(userId: string, message: ServerMessage): void;
}

interface PendingSettlement {
  position: Position;
  symbol: string;
  exitPrice: number;
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
    private readonly now: () => number = Date.now,
  ) {
    for (const asset of assets.all()) this.symbolByAssetId.set(asset.id, asset.symbol);
  }

  async open(input: EngineOpenTradeInput): Promise<OpenTradeResult> {
    const asset = this.assets.get(input.symbol);
    if (!asset) throw new DeskRejection("unknown_asset");

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
      throw err;
    }

    // No await between this check and book.add, so no tick can collect the
    // bucket in between. A write that outlasted the trade has no price from its
    // expiry second to settle against, so it is voided like an outage.
    const expirySec = expirySecFor(expiryTs.getTime());
    if (expirySec <= Math.floor(this.now() / 1000)) {
      const voided = await voidTrade(opened.trade.id);
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
      for (const position of bucket.positions) {
        this.pending.push({ position, symbol, exitPrice, attempts: 0 });
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
      const item = this.pending[0]!;
      let settled: SettledTrade;
      try {
        settled = await settleTrade({
          tradeId: item.position.tradeId,
          exitPrice: item.exitPrice,
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
      this.announce(settled, item.symbol);
    }
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
