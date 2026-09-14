import {
  WINDOW_SIZE,
  stageFor,
  tradeWeight,
  type AccountStats,
  type LifecycleStage,
  type WindowEntry,
} from "@asm/algo";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Reads everything the controller needs for one account.
 *
 * The rolling window is reconstructed from the last WINDOW_SIZE settled trades
 * rather than kept as a denormalised blob — Trade is already the source of
 * truth, and a second copy is one more thing that can drift out of step.
 *
 * REFUNDED trades are excluded from the query entirely. Counting a tie as a
 * loss would bias every estimate downward.
 *
 * lifecycleOverride, when set, takes precedence over the computed stage so an
 * operator can force-pin a demo account to a specific stage for testing.
 */
export async function loadAccountStats(accountId: string): Promise<AccountStats> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      type: true,
      lifecycleStage: true,
      lifecycleOverride: true,
      medianStake: true,
      lossStreak: true,
      winStreak: true,
      user: { select: { cumulativeDeposits: true, isBot: true } },
    },
  });

  const recent = await prisma.trade.findMany({
    where: { accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true, status: true },
  });

  const medianStake = account.medianStake > 0 ? account.medianStake : 100;

  // Reverse so the window reads oldest-first, matching the harness.
  const shortWindow: WindowEntry[] = recent
    .slice()
    .reverse()
    .map((t) => ({
      weight: tradeWeight(t.stake, medianStake),
      won: t.status === "WON",
    }));

  const lifetime = await prisma.trade.groupBy({
    by: ["status"],
    where: { accountId, status: { in: ["WON", "LOST"] } },
    _sum: { stake: true },
    _count: { _all: true },
  });

  let lifetimeWonWeight = 0;
  let lifetimeTotalWeight = 0;
  for (const row of lifetime) {
    const count = row._count._all;
    const avgStake = (row._sum.stake ?? 0) / Math.max(1, count);
    const weight = tradeWeight(avgStake, medianStake) * count;
    lifetimeTotalWeight += weight;
    if (row.status === "WON") lifetimeWonWeight += weight;
  }

  // Override wins over computed stage; bots are always PRE_DEPOSIT.
  const stage: LifecycleStage =
    (account.lifecycleOverride as LifecycleStage | null) ??
    stageFor(account.user.cumulativeDeposits, account.type === "DEMO" || account.user.isBot);

  return {
    stage,
    shortWindow,
    lifetimeWonWeight,
    lifetimeTotalWeight,
    lossStreak: account.lossStreak,
    winStreak: account.winStreak,
    medianStake,
  };
}

/**
 * Updates the counters a settled trade affects. Called INSIDE the settlement
 * transaction so stats and trade outcome are always in sync — a crash between
 * the two cannot leave them diverged.
 *
 * A REFUNDED outcome is a no-op by design.
 */
export async function recordOutcomeInTx(
  tx: Tx,
  input: {
    accountId: string;
    stake: number;
    outcome: "WON" | "LOST" | "REFUNDED";
  },
): Promise<void> {
  if (input.outcome === "REFUNDED") return;

  const account = await tx.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: {
      type: true,
      lossStreak: true,
      winStreak: true,
      user: { select: { cumulativeDeposits: true, isBot: true } },
    },
  });

  const won = input.outcome === "WON";

  // Median over a bounded recent sample — cheap and outlier-resistant.
  const stakes = await tx.trade.findMany({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true },
  });
  const sorted = stakes.map((s) => s.stake).sort((a, b) => a - b);
  const medianStake =
    sorted.length === 0 ? input.stake : sorted[Math.floor(sorted.length / 2)]!;

  const settledCount = await tx.trade.count({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
  });
  const wonCount = await tx.trade.count({
    where: { accountId: input.accountId, status: "WON" },
  });

  const stage = stageFor(
    account.user.cumulativeDeposits,
    account.type === "DEMO" || account.user.isBot,
  );

  await tx.account.update({
    where: { id: input.accountId },
    data: {
      winStreak: won ? { increment: 1 } : 0,
      lossStreak: won ? 0 : { increment: 1 },
      tradesCount: settledCount,
      rollingWinRate: settledCount === 0 ? 0 : wonCount / settledCount,
      medianStake,
      lifecycleStage: stage,
    },
  });
}

export async function setLifecycleOverride(
  accountId: string,
  stage: LifecycleStage | null,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    // Prisma only clears optional fields when null is passed explicitly; undefined is a no-op.
    data: { lifecycleOverride: stage },
  });
}
