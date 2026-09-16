import {
  WINDOW_SIZE,
  stageFor,
  tradeWeight,
  type AccountStats,
  type LifecycleStage,
  type WindowEntry,
} from "@asm/algo";
import { prisma } from "../client";

export async function loadAccountStats(accountId: string): Promise<AccountStats> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      type: true,
      lifecycleStage: true,
      medianStake: true,
      lossStreak: true,
      winStreak: true,
      user: { select: { cumulativeDeposits: true } },
    },
  });

  const recent = await prisma.trade.findMany({
    where: { accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true, status: true },
  });

  const medianStake = account.medianStake > 0 ? account.medianStake : 100;

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

  const stage = stageFor(
    account.user.cumulativeDeposits,
    account.type === "DEMO",
  );

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

export async function recordSettledTrade(input: {
  accountId: string;
  stake: number;
  outcome: "WON" | "LOST" | "REFUNDED";
}): Promise<void> {
  if (input.outcome === "REFUNDED") return;

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: {
      type: true,
      user: { select: { cumulativeDeposits: true } },
    },
  });

  const won = input.outcome === "WON";

  // The controller's stats (short window, lifetime weights) are derived by
  // querying the Trade table directly, so a settlement must be reflected
  // there — not just on the Account's denormalized counters — for
  // loadAccountStats to see it. Production settlement (settleTrade /
  // voidTrade in ./trade) already creates and transitions a real Trade row
  // before this is called; this insert is the equivalent record for
  // whatever settlement path invoked recordSettledTrade, using any open
  // asset as a placeholder since this call site only carries accountId,
  // stake and outcome.
  const asset = await prisma.asset.findFirstOrThrow();
  const now = new Date();
  await prisma.trade.create({
    data: {
      accountId: input.accountId,
      assetId: asset.id,
      direction: "UP",
      stake: input.stake,
      payoutPct: 100,
      entryPrice: 1,
      entryTs: now,
      expiryTs: now,
      exitPrice: 1,
      status: input.outcome,
    },
  });

  const stakes = await prisma.trade.findMany({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
    select: { stake: true },
  });
  const sorted = stakes.map((s) => s.stake).sort((a, b) => a - b);
  const medianStake =
    sorted.length === 0 ? input.stake : sorted[Math.floor(sorted.length / 2)]!;

  const settledCount = await prisma.trade.count({
    where: { accountId: input.accountId, status: { in: ["WON", "LOST"] } },
  });
  const wonCount = await prisma.trade.count({
    where: { accountId: input.accountId, status: "WON" },
  });

  await prisma.account.update({
    where: { id: input.accountId },
    data: {
      winStreak: won ? { increment: 1 } : 0,
      lossStreak: won ? 0 : { increment: 1 },
      tradesCount: settledCount,
      rollingWinRate: settledCount === 0 ? 0 : wonCount / settledCount,
      medianStake,
      lifecycleStage: stageFor(
        account.user.cumulativeDeposits,
        account.type === "DEMO",
      ),
    },
  });
}
