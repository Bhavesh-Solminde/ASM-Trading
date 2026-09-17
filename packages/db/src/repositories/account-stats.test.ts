import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { loadAccountStats, recordSettledTrade } from "./account-stats";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter });

let accountId = "";
let demoAccountId = "";
let assetId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: {
      email: `s-${process.hrtime.bigint()}@test.local`,
      passwordHash: "x",
    },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  accountId = accounts.find((a) => a.type === "LIVE")!.id;
  demoAccountId = accounts.find((a) => a.type === "DEMO")!.id;

  const asset = await prisma.asset.upsert({
    where: { symbol: "TEST_OTC" },
    update: {},
    create: { symbol: "TEST_OTC", displayName: "Test OTC", kind: "OTC", payoutPct: 85, isOpen: true },
  });
  assetId = asset.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedTrade(acctId: string, stake: number, status: "WON" | "LOST") {
  const now = new Date();
  await prisma.trade.create({
    data: {
      accountId: acctId,
      assetId,
      direction: "UP",
      stake,
      payoutPct: 85,
      entryPrice: 1,
      entryTs: now,
      expiryTs: now,
      exitPrice: 1,
      status,
    },
  });
}

describe("loadAccountStats", () => {
  it("reports PRE_DEPOSIT for a fresh live account", async () => {
    const stats = await loadAccountStats(accountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
    expect(stats.shortWindow).toEqual([]);
  });

  it("always reports PRE_DEPOSIT for a demo account", async () => {
    await prisma.user.update({
      where: { id: (await prisma.account.findUniqueOrThrow({ where: { id: demoAccountId } })).userId },
      data: { cumulativeDeposits: 5_000_000 },
    });
    const stats = await loadAccountStats(demoAccountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
  });

  it("moves to DEPOSITED after a small deposit", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.user.update({
      where: { id: account.userId },
      data: { cumulativeDeposits: 10_000 },
    });
    expect((await loadAccountStats(accountId)).stage).toBe("DEPOSITED");
  });

  it("moves to HIGH_VALUE past the threshold", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.user.update({
      where: { id: account.userId },
      data: { cumulativeDeposits: 100_000 },
    });
    expect((await loadAccountStats(accountId)).stage).toBe("HIGH_VALUE");
  });
});

describe("recordSettledTrade", () => {
  it("increments the win streak and resets the loss streak on a win", async () => {
    await seedTrade(accountId, 10_000, "LOST");
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    await seedTrade(accountId, 10_000, "WON");
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "WON" });
    const stats = await loadAccountStats(accountId);
    expect(stats.winStreak).toBe(1);
    expect(stats.lossStreak).toBe(0);
  });

  it("increments the loss streak on consecutive losses", async () => {
    for (let i = 0; i < 3; i++) {
      await seedTrade(accountId, 10_000, "LOST");
      await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    }
    const stats = await loadAccountStats(accountId);
    expect(stats.lossStreak).toBe(3);
  });

  it("leaves streaks untouched for a refund", async () => {
    await seedTrade(accountId, 10_000, "LOST");
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    const before = await loadAccountStats(accountId);
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "REFUNDED" });
    const after = await loadAccountStats(accountId);

    expect(after.lossStreak).toBe(before.lossStreak);
    expect(after.lifetimeTotalWeight).toBeCloseTo(before.lifetimeTotalWeight, 6);
  });

  it("accumulates lifetime weight and won weight", async () => {
    await seedTrade(accountId, 10_000, "WON");
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "WON" });
    await seedTrade(accountId, 10_000, "LOST");
    await recordSettledTrade({ accountId, stake: 10_000, outcome: "LOST" });
    const stats = await loadAccountStats(accountId);
    expect(stats.lifetimeTotalWeight).toBeGreaterThan(0);
    expect(stats.lifetimeWonWeight).toBeGreaterThan(0);
    expect(stats.lifetimeWonWeight).toBeLessThan(stats.lifetimeTotalWeight);
  });

  it("tracks a median stake that resists outliers", async () => {
    for (const stake of [10_000, 10_000, 10_000, 10_000, 5_000_000]) {
      await seedTrade(accountId, stake, "LOST");
      await recordSettledTrade({ accountId, stake, outcome: "LOST" });
    }
    const stats = await loadAccountStats(accountId);
    expect(stats.medianStake).toBeLessThan(100_000);
  });
});
