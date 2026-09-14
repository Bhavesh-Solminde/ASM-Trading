import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  AlreadySettled,
  InsufficientFunds,
  listTradesForActor,
  loadOpenPositions,
  openTrade,
  settleTrade,
  voidTrade,
  type OpenTradeInput,
} from "./trade";

const RUN = randomUUID();
let assetId = "";
let seq = 0;

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
});

afterAll(async () => {
  // Cascades to accounts, trades and ledger rows.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function demoAccount(balance = 1_000_000): Promise<{ userId: string; accountId: string }> {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `trade-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, balance);
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

async function balanceOf(accountId: string): Promise<{ real: number; bonus: number }> {
  const a = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  return { real: a.realBalance, bonus: a.bonusBalance };
}

describe("openTrade", () => {
  it("debits the stake, records the trade, and writes its ledger row together", async () => {
    const { accountId } = await demoAccount();
    const opened = await openTrade(order(accountId));

    expect(opened.trade.status).toBe("OPEN");
    expect(opened.realBalance).toBe(990_000);

    const ledger = await prisma.transaction.findMany({ where: { accountId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "TRADE_STAKE",
      amount: -10_000,
      balanceAfter: 990_000,
      refType: "Trade",
      refId: opened.trade.id,
    });
  });

  it("refuses an unaffordable stake and leaves no trace", async () => {
    const { accountId } = await demoAccount();
    await expect(openTrade(order(accountId, { stake: 2_000_000 }))).rejects.toBeInstanceOf(
      InsufficientFunds,
    );
    expect(await balanceOf(accountId)).toEqual({ real: 1_000_000, bonus: 0 });
    expect(await prisma.trade.count({ where: { accountId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(0);
  });

  it("draws real balance before bonus and records the bonus part", async () => {
    const { accountId } = await demoAccount();
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 5_000, bonusBalance: 20_000 },
    });
    const opened = await openTrade(order(accountId));
    expect(opened.realBalance).toBe(0);
    expect(opened.bonusBalance).toBe(15_000);
    expect(opened.trade.stakeFromBonus).toBe(5_000);
  });

  it("never over-debits under concurrency, and every success has exactly one trade and ledger row", async () => {
    const { accountId } = await demoAccount();
    // 1,000,000 available; ten parallel 200,000 stakes -> at most five can succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => openTrade(order(accountId, { stake: 200_000 }))),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const { real } = await balanceOf(accountId);
    // Guards against a vacuous pass where every attempt exhausted its retries.
    expect(succeeded).toBeGreaterThan(0);
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(real).toBe(1_000_000 - succeeded * 200_000);
    expect(await prisma.trade.count({ where: { accountId } })).toBe(succeeded);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(succeeded);
  });

  it("increments the account version on every debit", async () => {
    const { accountId } = await demoAccount();
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await openTrade(order(accountId, { stake: 1_000 }));
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.version).toBe(before.version + 1);
  });
});

describe("listTradesForActor", () => {
  it("returns an account's trades only to its owner", async () => {
    const owner = await demoAccount();
    const stranger = await demoAccount();
    await openTrade(order(owner.accountId));

    expect(await listTradesForActor(stranger.userId, owner.accountId, 50)).toEqual([]);
    expect(await listTradesForActor(owner.userId, owner.accountId, 50)).toHaveLength(1);
  });
});

describe("settleTrade", () => {
  it("credits stake plus profit on a win and reports the owner", async () => {
    const { userId, accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });

    expect(settled.trade.status).toBe("WON");
    expect(settled.trade.pnl).toBe(10_000);
    expect(settled.realBalance).toBe(1_010_000);
    expect(settled.userId).toBe(userId);
  });

  it("credits nothing on a loss", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.174 });
    expect(settled.trade.status).toBe("LOST");
    expect(settled.trade.pnl).toBe(-10_000);
    expect(settled.realBalance).toBe(990_000);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(1);
  });

  it("refunds the stake on an exact tie", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId, { direction: "DOWN" }));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.175 });
    expect(settled.trade.status).toBe("REFUNDED");
    expect(settled.realBalance).toBe(1_000_000);
  });

  it("is idempotent — a second settlement throws and pays nothing", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    await expect(settleTrade({ tradeId: trade.id, exitPrice: 1.176 })).rejects.toBeInstanceOf(
      AlreadySettled,
    );
    expect((await balanceOf(accountId)).real).toBe(1_010_000);
    expect(await prisma.transaction.count({ where: { accountId } })).toBe(2);
  });

  it("returns a bonus-funded stake's winnings to bonus in the stake's proportion", async () => {
    const { accountId } = await demoAccount();
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 4_000, bonusBalance: 6_000 },
    });
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(settled.realBalance).toBe(8_000);
    expect(settled.bonusBalance).toBe(12_000);
  });

  it("writes a payout ledger row whose balanceAfter matches the account", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const settled = await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    const payout = await prisma.transaction.findFirstOrThrow({
      where: { accountId, kind: "TRADE_PAYOUT" },
    });
    expect(payout.amount).toBe(20_000);
    expect(payout.refId).toBe(trade.id);
    expect(payout.balanceAfter).toBe(settled.realBalance + settled.bonusBalance);
  });
});

describe("voidTrade", () => {
  it("refunds the stake with no exit price", async () => {
    const { accountId } = await demoAccount();
    const { trade } = await openTrade(order(accountId));
    const voided = await voidTrade(trade.id);
    expect(voided.trade.status).toBe("REFUNDED");
    expect(voided.trade.exitPrice).toBeNull();
    expect(voided.realBalance).toBe(1_000_000);
  });
});

describe("loadOpenPositions", () => {
  it("includes open trades with expiry rounded up, and excludes settled ones", async () => {
    const { accountId } = await demoAccount();
    const expiryTs = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_500);
    const open = await openTrade(order(accountId, { expiryTs }));
    const closed = await openTrade(order(accountId, { expiryTs }));
    await settleTrade({ tradeId: closed.trade.id, exitPrice: 1.176 });

    const positions = await loadOpenPositions();
    const mine = positions.find((p) => p.tradeId === open.trade.id);
    expect(mine?.expirySec).toBe(Math.ceil(expiryTs.getTime() / 1000));
    expect(positions.some((p) => p.tradeId === closed.trade.id)).toBe(false);
  });
});
