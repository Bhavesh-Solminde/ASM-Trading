import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import {
  directionToDb,
  directionFromDb,
  type EngineCfdOpenTradeInput,
  type CfdTradeView,
  type CfdOpenTradeResult,
  type CfdCloseReasonDto,
} from "@asm/contracts";
import { isHardBlocked, earlyCloseMultiplier } from "./spread";

export interface AssetConfig {
  id: string;
  symbol: string;
  spreadBps: number;
}

export interface RiskLimits {
  treasuryMinor: number;
  netExposure: number;
  exposureCap: number;
  userDailyPnl: number;
  dailyWinCap: number;
  dynamicMaxStake: number;
  isCircuitBroken: boolean;
}

export interface ClosedPosition {
  tradeId: string;
  accountId: string;
  reason: CfdCloseReasonDto;
  exitPrice: number;
  pnl: number;
}

function toView(
  trade: {
    id: string;
    accountId: string;
    direction: string;
    stake: number;
    spreadFee?: number;
    entryPrice: number;
    entryTs: Date;
    expiryTs: Date;
    exitPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    trailingPct: number | null;
    liqPrice: number | null;
    closeReason: string | null;
    status: string;
    pnl: number;
  },
  symbol: string,
): CfdTradeView {
  return {
    id: trade.id,
    accountId: trade.accountId,
    symbol,
    direction: directionFromDb(trade.direction as "UP" | "DOWN"),
    stake: trade.stake,
    spreadFee: trade.spreadFee ?? 0,
    entryPrice: trade.entryPrice,
    entryTs: Math.floor(trade.entryTs.getTime() / 1000),
    expiryTs: Math.floor(trade.expiryTs.getTime() / 1000),
    exitPrice: trade.exitPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    trailingPct: trade.trailingPct,
    liqPrice: trade.liqPrice ?? 0,
    closeReason: trade.closeReason as CfdCloseReasonDto | null,
    status: trade.status === "OPEN" ? "OPEN" : "CLOSED",
    pnl: trade.pnl,
  };
}

export class CfdDesk {
  constructor(
    private readonly onClosed?: (tradeId: string) => Promise<void>,
    private readonly onOpened?: (result: CfdOpenTradeResult, actorId: string) => void,
  ) {}

  async open(
    input: EngineCfdOpenTradeInput,
    shownMidPrice: number,
    asset: AssetConfig,
    risk: RiskLimits,
  ): Promise<CfdOpenTradeResult> {
    if (risk.isCircuitBroken) {
      throw new Error("MARKET_UNAVAILABLE");
    }

    if (isHardBlocked(risk.userDailyPnl, risk.dailyWinCap)) {
      throw new Error("TRADING_PAUSED");
    }

    if (input.stake > risk.dynamicMaxStake) {
      throw new Error("STAKE_EXCEEDS_LIMIT");
    }

    const dbDir = directionToDb(input.direction);
    const stakeChange = dbDir === "UP" ? input.stake : -input.stake;
    if (Math.abs(risk.netExposure + stakeChange) > risk.exposureCap) {
      throw new Error("MARKET_UNAVAILABLE");
    }

    // The ticket and chart expose one execution price. Opening at an unseen
    // bid/ask or user-specific skew creates a displaced entry line immediately.
    const entry = shownMidPrice;
    const spreadFee = Math.round(input.stake * asset.spreadBps / 10000);
    const totalDebit = input.stake + spreadFee;
    // Percent controls are resolved against the actual execution price and side.
    const side = dbDir === "UP" ? 1 : -1;
    const stopLoss = input.stopLossPct == null ? input.stopLoss ?? null
      : entry * (1 - side * input.stopLossPct / 100);
    const takeProfit = input.takeProfitPct == null ? input.takeProfit ?? null
      : entry * (1 + side * input.takeProfitPct / 100);
    if ((stopLoss != null && (stopLoss <= 0 || (dbDir === "UP" ? stopLoss >= entry : stopLoss <= entry))) ||
        (takeProfit != null && (takeProfit <= 0 || (dbDir === "UP" ? takeProfit <= entry : takeProfit >= entry)))) {
      throw new Error("INVALID_STOPS");
    }

    // Unleveraged CFD: LONG liq at 0, SHORT liq at 2× entry
    const liqPrice = dbDir === "UP" ? 0 : entry * 2;

    const now = new Date();
    const expiryTs = new Date(now.getTime() + input.durationSec * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUniqueOrThrow({
        where: { id: input.accountId },
      });

      const totalBalance = account.realBalance + account.bonusBalance;
      if (totalBalance < totalDebit) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      const fromBonus = Math.min(account.bonusBalance, input.stake);
      const feeFromBonus = Math.min(account.bonusBalance - fromBonus, spreadFee);
      const fromReal = input.stake - fromBonus + spreadFee - feeFromBonus;

      const trade = await tx.trade.create({
        data: {
          accountId: input.accountId,
          assetId: asset.id,
          direction: dbDir,
          stake: input.stake,
          spreadFee,
          stakeFromBonus: fromBonus,
          payoutPct: 0,
          entryPrice: entry,
          entryTs: now,
          expiryTs,
          status: "OPEN",
          durationSec: input.durationSec,
          stopLoss,
          takeProfit,
          trailingPct: input.trailingPct ?? null,
          liqPrice,
          peakPnl: 0,
        },
      });

      const debit = await tx.account.updateMany({
        where: { id: input.accountId, realBalance: account.realBalance, bonusBalance: account.bonusBalance },
        data: {
          realBalance: { decrement: fromReal },
          bonusBalance: { decrement: fromBonus + feeFromBonus },
        },
      });

      if (debit.count !== 1) throw new Error("INSUFFICIENT_BALANCE");
      await tx.transaction.createMany({ data: [
        { accountId: input.accountId, kind: "TRADE_STAKE", amount: -input.stake,
          balanceAfter: totalBalance - input.stake, refType: "Trade", refId: trade.id },
        { accountId: input.accountId, kind: "TRADE_FEE", amount: -spreadFee,
          balanceAfter: totalBalance - totalDebit, refType: "Trade", refId: trade.id },
      ] });
      if (account.type === "LIVE" && spreadFee > 0) {
        await tx.houseTreasury.upsert({ where: { id: 1 },
          update: { treasuryMinor: { increment: spreadFee } },
          create: { id: 1, treasuryMinor: spreadFee, treasuryTargetMinor: 30000000 } });
      }
      const updated = await tx.account.findUniqueOrThrow({
        where: { id: input.accountId },
        select: { realBalance: true, bonusBalance: true },
      });

      return { trade, balances: updated };
    });

    const view = toView(result.trade, asset.symbol);

    logger.info(
      { evt: "cfd.open", tradeId: view.id, symbol: asset.symbol, dir: input.direction, stake: input.stake, entry },
      "CFD position opened",
    );

    const opened = { trade: view, balances: result.balances };
    this.onOpened?.(opened, input.actorId);
    return opened;
  }

  async scanPositions(
    assetId: string,
    symbol: string,
    shownPrice: number,
    now: Date,
  ): Promise<ClosedPosition[]> {
    const openTrades = await prisma.trade.findMany({
      where: { assetId, status: "OPEN", durationSec: { not: null } },
    });

    const closed: ClosedPosition[] = [];

    for (const trade of openTrades) {
      try {
        const trigger = this.checkTriggers(trade, shownPrice, now);
        if (trigger) {
          const result = await this.closePosition(
            trade,
            trigger.reason,
            trigger.exitPrice,
            now,
          );
          closed.push(result);
        } else {
          // Update peak PnL for trailing stop tracking
          const isLong = trade.direction === "UP";
          const pnl = Math.round(
            (isLong
              ? (shownPrice - trade.entryPrice) / trade.entryPrice
              : (trade.entryPrice - shownPrice) / trade.entryPrice) * trade.stake,
          );
          if (pnl > (trade.peakPnl ?? 0)) {
            await prisma.trade.update({
              where: { id: trade.id },
              data: { peakPnl: pnl },
            });
          }
        }
      } catch {
        logger.error({ evt: "cfd.settlement_failed", tradeId: trade.id },
          "position processing failed; retrying next tick");
      }
    }

    return closed;
  }

  private checkTriggers(
    trade: {
      direction: string;
      entryPrice: number;
      stake: number;
    spreadFee?: number;
      expiryTs: Date;
      stopLoss: number | null;
      takeProfit: number | null;
      trailingPct: number | null;
      liqPrice: number | null;
      peakPnl: number | null;
    },
    shownPrice: number,
    now: Date,
  ): { reason: CfdCloseReasonDto; exitPrice: number } | null {
    const isLong = trade.direction === "UP";

    // 1. Liquidation (highest priority)
    if (trade.liqPrice != null) {
      if (isLong && shownPrice <= trade.liqPrice) {
        return { reason: "LIQUIDATION", exitPrice: trade.liqPrice };
      }
      if (!isLong && shownPrice >= trade.liqPrice) {
        return { reason: "LIQUIDATION", exitPrice: trade.liqPrice };
      }
    }

    // 2. Stop loss (with trailing)
    if (trade.stopLoss != null) {
      let effectiveSl = trade.stopLoss;

      if (trade.trailingPct != null && trade.trailingPct > 0) {
        const trailedSl = isLong
          ? shownPrice * (1 - trade.trailingPct / 100)
          : shownPrice * (1 + trade.trailingPct / 100);

        if (isLong) effectiveSl = Math.max(effectiveSl, trailedSl);
        else effectiveSl = Math.min(effectiveSl, trailedSl);
      }

      if (isLong && shownPrice <= effectiveSl) {
        return {
          reason: trade.trailingPct ? "TRAILING_STOP" : "STOP_LOSS",
          exitPrice: effectiveSl,
        };
      }
      if (!isLong && shownPrice >= effectiveSl) {
        return {
          reason: trade.trailingPct ? "TRAILING_STOP" : "STOP_LOSS",
          exitPrice: effectiveSl,
        };
      }
    }

    // 3. Take profit
    if (trade.takeProfit != null) {
      if (isLong && shownPrice >= trade.takeProfit) {
        return { reason: "TAKE_PROFIT", exitPrice: trade.takeProfit };
      }
      if (!isLong && shownPrice <= trade.takeProfit) {
        return { reason: "TAKE_PROFIT", exitPrice: trade.takeProfit };
      }
    }

    // 4. Duration expiry
    if (now >= trade.expiryTs) {
      return { reason: "DURATION", exitPrice: shownPrice };
    }

    return null;
  }

  async closePosition(
    trade: {
      id: string;
      accountId: string;
      direction: string;
      entryPrice: number;
      stake: number;
    spreadFee?: number;
      stakeFromBonus: number;
    },
    reason: CfdCloseReasonDto,
    exitPrice: number,
    now: Date,
  ): Promise<ClosedPosition> {
    const isLong = trade.direction === "UP";
    const pnlFrac = isLong
      ? (exitPrice - trade.entryPrice) / trade.entryPrice
      : (trade.entryPrice - exitPrice) / trade.entryPrice;
    const rawPnl = Math.round(pnlFrac * trade.stake);
    const grossPnl = Math.max(rawPnl, -trade.stake);
    const pnl = grossPnl - (trade.spreadFee ?? 0);

    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          exitPrice,
          pnl,
          status: "CLOSED",
          closeReason: reason,
          closedAt: now,
        },
      });

      const netReturn = trade.stake + grossPnl;
      if (netReturn > 0) {
        const bonusRatio = trade.stake > 0 ? trade.stakeFromBonus / trade.stake : 0;
        const bonusReturn = Math.round(netReturn * bonusRatio);
        const realReturn = netReturn - bonusReturn;

        await tx.account.update({
          where: { id: trade.accountId },
          data: {
            realBalance: { increment: realReturn },
            bonusBalance: { increment: bonusReturn },
          },
        });
      }

      // Fetch account type to determine if house treasury should update
      const account = await tx.account.findUnique({
        where: { id: trade.accountId },
        select: { type: true },
      });

      if (account?.type === "LIVE") {
        const housePnl = -grossPnl;
        await tx.houseTreasury.upsert({
          where: { id: 1 },
          update: { treasuryMinor: { increment: housePnl } },
          create: { id: 1, treasuryMinor: housePnl, treasuryTargetMinor: 30_000_000 },
        });
      }
    });

    logger.info(
      { evt: "cfd.close", tradeId: trade.id, reason, exitPrice, pnl },
      "CFD position closed",
    );

    // Persistence succeeded: notification failure must not undo or repeat payment.
    try { await this.onClosed?.(trade.id); } catch {
      logger.warn({ evt: "cfd.notify_failed", tradeId: trade.id }, "settlement notification failed");
    }
    return { tradeId: trade.id, accountId: trade.accountId, reason, exitPrice, pnl };
  }

  async manualClose(
    tradeId: string,
    shownPrice: number,
    asset: AssetConfig,
    userDailyPnl: number,
    dailyWinCap: number,
  ): Promise<ClosedPosition> {
    const trade = await prisma.trade.findUniqueOrThrow({
      where: { id: tradeId },
    });

    if (trade.status !== "OPEN") {
      throw new Error("TRADE_NOT_OPEN");
    }

    const ageSec = (Date.now() - trade.entryTs.getTime()) / 1000;
    const closeMultiplier = earlyCloseMultiplier(ageSec);
    if (closeMultiplier === Infinity) {
      throw new Error("LOCKOUT_ACTIVE");
    }

    // The full spread was paid at opening; do not charge it again in the exit price.
    const exitPrice = shownPrice;

    return this.closePosition(
      {
        id: trade.id,
        accountId: trade.accountId,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        stake: trade.stake,
        spreadFee: trade.spreadFee ?? 0,
        stakeFromBonus: trade.stakeFromBonus,
      },
      "MANUAL",
      exitPrice,
      new Date(),
    );
  }

  async openPositionsForAsset(assetId: string) {
    return prisma.trade.findMany({
      where: { assetId, status: "OPEN", durationSec: { not: null } },
    });
  }

  async modify(
    tradeId: string,
    changes: { stopLoss?: number | null; takeProfit?: number | null },
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (changes.stopLoss !== undefined) data.stopLoss = changes.stopLoss;
    if (changes.takeProfit !== undefined) data.takeProfit = changes.takeProfit;

    if (Object.keys(data).length === 0) return;

    await prisma.trade.update({
      where: { id: tradeId, status: "OPEN" },
      data,
    });

    logger.info({ evt: "cfd.modify", tradeId, ...changes }, "CFD position modified");
  }
}
