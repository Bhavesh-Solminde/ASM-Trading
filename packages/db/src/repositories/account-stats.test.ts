import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { openTradeRecord, settleTrade, type OpenTradeInput } from "./trade";
import { loadAccountStats, setLifecycleOverride } from "./account-stats";

const RUN = randomUUID();
let assetId = "";
let seq = 0;

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function demoAccount(): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `stats-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  return { userId: user.id, accountId: accounts.find((a) => a.type === "DEMO")!.id };
}

function order(accountId: string, overrides: Partial<OpenTradeInput> = {}): OpenTradeInput {
  return {
    accountId,
    assetId,
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: new Date(),
    expiryTs: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe("account-stats", () => {
  it("returns PRE_DEPOSIT stage and empty window for a brand-new demo account", async () => {
    const { accountId } = await demoAccount();
    const stats = await loadAccountStats(accountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
    expect(stats.shortWindow).toHaveLength(0);
    expect(stats.lossStreak).toBe(0);
    expect(stats.winStreak).toBe(0);
  });

  it("populates shortWindow after settled trades", async () => {
    const { accountId } = await demoAccount();
    const t = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: t.id, exitPrice: 1.176 }); // WON
    const stats = await loadAccountStats(accountId);
    expect(stats.shortWindow).toHaveLength(1);
    expect(stats.shortWindow[0]!.won).toBe(true);
  });

  it("increments winStreak and resets lossStreak on a win", async () => {
    const { accountId } = await demoAccount();
    // Force a loss first, then a win
    const t1 = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: t1.id, exitPrice: 1.174 }); // LOST
    const t2 = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: t2.id, exitPrice: 1.176 }); // WON
    const stats = await loadAccountStats(accountId);
    expect(stats.winStreak).toBe(1);
    expect(stats.lossStreak).toBe(0);
  });

  it("does not count REFUNDED trades in the window", async () => {
    const { accountId } = await demoAccount();
    const t = await openTradeRecord(order(accountId));
    // voidTrade applies REFUNDED outcome
    const { voidTrade } = await import("./trade");
    await voidTrade(t.id);
    const stats = await loadAccountStats(accountId);
    expect(stats.shortWindow).toHaveLength(0);
  });

  it("applies lifecycleOverride over computed stage", async () => {
    const { accountId } = await demoAccount();
    await setLifecycleOverride(accountId, "HIGH_VALUE");
    const stats = await loadAccountStats(accountId);
    expect(stats.stage).toBe("HIGH_VALUE");
  });

  it("clearing lifecycleOverride restores computed stage", async () => {
    const { accountId } = await demoAccount();
    await setLifecycleOverride(accountId, "HIGH_VALUE");
    await setLifecycleOverride(accountId, null);
    const stats = await loadAccountStats(accountId);
    expect(stats.stage).toBe("PRE_DEPOSIT");
  });

  it("rollingWinRate on Account is updated by settlement", async () => {
    const { accountId } = await demoAccount();
    const t1 = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: t1.id, exitPrice: 1.176 }); // WON
    const t2 = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: t2.id, exitPrice: 1.176 }); // WON
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.rollingWinRate).toBeCloseTo(1.0, 3);
  });
});
