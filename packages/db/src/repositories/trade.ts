import {
  didWin,
  expirySecFor,
  settlementCredit,
  settlementPnl,
  splitSettlementCredit,
  type Outcome,
  type Position,
} from "@asm/trading";
import { prisma } from "../client";
import type { Direction, Prisma, Trade, TradeShadow } from "../../generated/prisma/client";
import { recordOutcomeInTx } from "./account-stats";

export class InsufficientFunds extends Error {
  constructor() {
    super("Not enough balance for that stake.");
    this.name = "InsufficientFunds";
  }
}

export class ConcurrentModification extends Error {
  constructor() {
    super("The account changed while this request was in flight. Try again.");
    this.name = "ConcurrentModification";
  }
}

export class AlreadySettled extends Error {
  constructor(tradeId: string) {
    super(`Trade ${tradeId} is already settled.`);
    this.name = "AlreadySettled";
  }
}

export class TradeNotFound extends Error {
  constructor(tradeId: string) {
    super(`Trade ${tradeId} not found.`);
    this.name = "TradeNotFound";
  }
}

/** Thrown inside a transaction to roll it back for a retry. Never escapes this module. */
class VersionConflict extends Error {}

const MAX_ATTEMPTS = 5;

type Tx = Prisma.TransactionClient;

export interface OpenTradeInput {
  accountId: string;
  assetId: string;
  direction: Direction;
  stake: number;
  payoutPct: number;
  entryPrice: number;
  entryTs: Date;
  expiryTs: Date;
}

export interface OpenedTrade {
  trade: Trade;
  realBalance: number;
  bonusBalance: number;
}

export interface SettledTrade {
  trade: Trade;
  userId: string;
  realBalance: number;
  bonusBalance: number;
}

/**
 * Debits the stake and records the trade in ONE transaction, with its ledger row.
 *
 * Concurrency is optimistic: the debit is conditional on the version read in
 * the same transaction. Under READ COMMITTED a competing debit that commits
 * first makes this update match zero rows, so we roll back and retry against
 * the new balance. Two simultaneous trades therefore cannot both spend the
 * same money.
 *
 * Real balance is consumed before bonus, and the bonus part is recorded on the
 * trade so settlement can return it where it came from.
 */
export async function openTrade(input: OpenTradeInput): Promise<OpenedTrade> {
  if (!Number.isInteger(input.stake) || input.stake <= 0) {
    throw new Error(`stake must be a positive integer, received ${input.stake}`);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        if (!account) throw new Error(`Account ${input.accountId} not found`);
        if (account.realBalance + account.bonusBalance < input.stake) {
          throw new InsufficientFunds();
        }

        const fromReal = Math.min(account.realBalance, input.stake);
        const fromBonus = input.stake - fromReal;

        const claimed = await tx.account.updateMany({
          where: { id: account.id, version: account.version },
          data: {
            realBalance: { decrement: fromReal },
            bonusBalance: { decrement: fromBonus },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new VersionConflict();

        const trade = await tx.trade.create({
          data: {
            accountId: input.accountId,
            assetId: input.assetId,
            direction: input.direction,
            stake: input.stake,
            stakeFromBonus: fromBonus,
            // Snapshotted, so a later payout change cannot alter this position's terms.
            payoutPct: input.payoutPct,
            entryPrice: input.entryPrice,
            entryTs: input.entryTs,
            expiryTs: input.expiryTs,
            status: "OPEN",
          },
        });

        const realBalance = account.realBalance - fromReal;
        const bonusBalance = account.bonusBalance - fromBonus;

        await tx.transaction.create({
          data: {
            accountId: input.accountId,
            kind: "TRADE_STAKE",
            amount: -input.stake,
            balanceAfter: realBalance + bonusBalance,
            refType: "Trade",
            refId: trade.id,
          },
        });

        return { trade, realBalance, bonusBalance };
      });
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }

  throw new ConcurrentModification();
}

/**
 * Creates a trade record without debiting balance. Used by bots (whose balance
 * is managed separately via top-up) and by tests that need a trade row without
 * the full accounting machinery.
 */
export async function openTradeRecord(input: OpenTradeInput): Promise<Trade> {
  return prisma.trade.create({
    data: {
      accountId: input.accountId,
      assetId: input.assetId,
      direction: input.direction,
      stake: input.stake,
      stakeFromBonus: 0,
      payoutPct: input.payoutPct,
      entryPrice: input.entryPrice,
      entryTs: input.entryTs,
      expiryTs: input.expiryTs,
      status: "OPEN",
    },
  });
}

type TradeWithOwner = Trade & { account: { userId: string } };

/**
 * Claims, credits and records one settlement inside the caller's transaction.
 * The status guard on the claim is what makes settlement idempotent: a replay
 * matches zero rows and throws before any money moves.
 */
async function applySettlement(
  tx: Tx,
  trade: TradeWithOwner,
  outcome: Outcome,
  exitPrice: number | null,
  shadow?: ShadowInput,
): Promise<SettledTrade> {
  const credit = settlementCredit(trade.stake, trade.payoutPct, outcome);
  const pnl = settlementPnl(trade.stake, trade.payoutPct, outcome);

  const claimed = await tx.trade.updateMany({
    where: { id: trade.id, status: "OPEN" },
    data: { status: outcome, exitPrice, pnl },
  });
  if (claimed.count !== 1) throw new AlreadySettled(trade.id);

  // Record outcome stats inside the same transaction — outcome and stats
  // are always consistent, even if the process crashes immediately after.
  await recordOutcomeInTx(tx, {
    accountId: trade.accountId,
    stake: trade.stake,
    outcome,
  });

  // Write the honest counterfactual when the engine supplies one.
  if (shadow && exitPrice !== null) {
    const honestOutcome = didWin(trade.direction, trade.entryPrice, shadow.honestExitPrice);
    const deltaPips = (exitPrice - shadow.honestExitPrice) / shadow.pipSize;
    await tx.tradeShadow.create({
      data: {
        tradeId: trade.id,
        shownExitPrice: exitPrice,
        honestExitPrice: shadow.honestExitPrice,
        shownResult: outcome,
        honestResult: honestOutcome,
        deltaPips,
        biasApplied: shadow.biasApplied,
        magnetApplied: shadow.magnetApplied,
        imbalanceAtEntry: shadow.imbalanceAtEntry,
        exposureUp: shadow.exposureUp,
        exposureDown: shadow.exposureDown,
        lifecycleStage: shadow.lifecycleStage,
        wantedWin: shadow.wantedWin ?? null,
        winProbability: shadow.winProbability ?? null,
      },
    });
  }

  let realBalance: number;
  let bonusBalance: number;

  if (credit > 0) {
    const { toReal, toBonus } = splitSettlementCredit(credit, trade.stake, trade.stakeFromBonus);
    const account = await tx.account.update({
      where: { id: trade.accountId },
      data: {
        realBalance: { increment: toReal },
        bonusBalance: { increment: toBonus },
        version: { increment: 1 },
      },
    });
    realBalance = account.realBalance;
    bonusBalance = account.bonusBalance;

    await tx.transaction.create({
      data: {
        accountId: trade.accountId,
        kind: outcome === "REFUNDED" ? "TRADE_REFUND" : "TRADE_PAYOUT",
        amount: credit,
        balanceAfter: realBalance + bonusBalance,
        refType: "Trade",
        refId: trade.id,
      },
    });
  } else {
    const account = await tx.account.findUniqueOrThrow({
      where: { id: trade.accountId },
      select: { realBalance: true, bonusBalance: true },
    });
    realBalance = account.realBalance;
    bonusBalance = account.bonusBalance;
  }

  const settled = await tx.trade.findUniqueOrThrow({ where: { id: trade.id } });
  return { trade: settled, userId: trade.account.userId, realBalance, bonusBalance };
}

async function loadOpenTrade(tx: Tx, tradeId: string): Promise<TradeWithOwner> {
  const trade = await tx.trade.findUnique({
    where: { id: tradeId },
    include: { account: { select: { userId: true } } },
  });
  if (!trade) throw new TradeNotFound(tradeId);
  if (trade.status !== "OPEN") throw new AlreadySettled(tradeId);
  return trade;
}

export interface ShadowInput {
  honestExitPrice: number;
  biasApplied: number;
  magnetApplied: number;
  imbalanceAtEntry: number;
  exposureUp: number;
  exposureDown: number;
  lifecycleStage: string;
  /** pip size for the asset (e.g. 0.00001 for 5dp FX). */
  pipSize: number;
  wantedWin?: boolean;
  winProbability?: number;
}

export interface SettleTradeInput {
  tradeId: string;
  exitPrice: number;
  /** When present, the honest counterfactual is recorded alongside the settlement. */
  shadow?: ShadowInput;
}

/** Settles one trade against a captured exit price, in one transaction. */
export async function settleTrade(input: SettleTradeInput): Promise<SettledTrade> {
  return prisma.$transaction(async (tx) => {
    const trade = await loadOpenTrade(tx, input.tradeId);
    const outcome = didWin(trade.direction, trade.entryPrice, input.exitPrice);
    return applySettlement(tx, trade, outcome, input.exitPrice, input.shadow);
  });
}

/**
 * Admin-only. There is deliberately no actor-scoped variant: no trading client
 * may ever read this, so no ownership-scoped accessor exists to be misused.
 */
export async function loadTradeShadow(tradeId: string): Promise<TradeShadow | null> {
  return prisma.tradeShadow.findUnique({ where: { tradeId } });
}

/**
 * Refunds a trade whose expiry passed while the engine was down. There is no
 * authoritative price for that moment, so it is recorded as REFUNDED with no
 * exit price rather than settled against a price from after the fact.
 */
export async function voidTrade(tradeId: string): Promise<SettledTrade> {
  return prisma.$transaction(async (tx) => {
    const trade = await loadOpenTrade(tx, tradeId);
    return applySettlement(tx, trade, "REFUNDED", null);
  });
}

/** Ownership is in the predicate — a caller cannot read another account's trades. */
export async function listTradesForActor(
  actorId: string,
  accountId: string,
  limit: number,
): Promise<Trade[]> {
  return prisma.trade.findMany({
    where: { accountId, account: { userId: actorId } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

/** Rehydrates the engine's book after a restart. */
export async function loadOpenPositions(): Promise<Position[]> {
  const rows = await prisma.trade.findMany({ where: { status: "OPEN" } });
  return rows.map((row) => ({
    tradeId: row.id,
    accountId: row.accountId,
    assetId: row.assetId,
    direction: row.direction,
    stake: row.stake,
    payoutPct: row.payoutPct,
    entryPrice: row.entryPrice,
    expirySec: expirySecFor(row.expiryTs.getTime()),
  }));
}
