import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { createAccountsForUser } from "./repositories/account";

/** One past the old INTEGER ceiling — the value that crash-looped the engine. */
const PAST_INT32 = 2_147_483_647 + 100_000_000;

let userId = "";
let accountId = "";
let assetId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `bigint-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(user.id, 0);
  accountId = accounts.find((a) => a.type === "DEMO")!.id;
  const asset = await prisma.asset.upsert({
    where: { symbol: "TEST_OTC" },
    update: {},
    create: { symbol: "TEST_OTC", displayName: "Test OTC", kind: "OTC", payoutPct: 85, isOpen: true },
  });
  assetId = asset.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "bigint-" } } });
  await prisma.$disconnect();
});

describe("money columns past the INTEGER ceiling", () => {
  it("increments a balance past 2^31 and reads it back as an exact number", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: 2_080_738_000 },
    });
    const updated = await prisma.account.update({
      where: { id: accountId },
      data: { realBalance: { increment: 100_000_000 } },
    });
    expect(updated.realBalance).toBe(2_180_738_000);
    expect(typeof updated.realBalance).toBe("number");
  });

  it("returns numbers for money fields on nested includes", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { realBalance: PAST_INT32 } });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true },
    });
    const demo = user.accounts.find((a) => a.id === accountId)!;
    expect(demo.realBalance).toBe(PAST_INT32);
    expect(typeof user.cumulativeDeposits).toBe("number");
  });

  it("returns numbers for nullable money fields, and keeps null", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.dailyLimit).toBeNull();
    const limited = await prisma.account.update({
      where: { id: accountId },
      data: { dailyLimit: PAST_INT32 },
    });
    expect(limited.dailyLimit).toBe(PAST_INT32);
  });

  it("stores a stake and pnl past 2^31", async () => {
    const now = new Date();
    const trade = await prisma.trade.create({
      data: {
        accountId,
        assetId,
        direction: "UP",
        stake: PAST_INT32,
        payoutPct: 92,
        entryPrice: 1,
        entryTs: now,
        expiryTs: now,
        exitPrice: 1,
        status: "WON",
        pnl: PAST_INT32,
      },
    });
    expect(trade.stake).toBe(PAST_INT32);
    expect(trade.pnl).toBe(PAST_INT32);
  });

  it("serialises money rows to JSON without a bigint error", async () => {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(() => JSON.stringify(account)).not.toThrow();
  });
});

describe("aggregates over money columns", () => {
  beforeEach(async () => {
    await prisma.account.updateMany({ where: { userId }, data: { realBalance: PAST_INT32 } });
  });

  it("returns aggregate _sum as a number", async () => {
    const agg = await prisma.account.aggregate({
      where: { userId },
      _sum: { realBalance: true },
      _max: { realBalance: true },
    });
    expect(agg._sum.realBalance).toBe(PAST_INT32 * 2);
    expect(agg._max.realBalance).toBe(PAST_INT32);
  });

  it("returns groupBy _sum as a number", async () => {
    const groups = await prisma.account.groupBy({
      by: ["type"],
      where: { userId },
      _sum: { realBalance: true },
    });
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g._sum.realBalance).toBe(PAST_INT32);
  });
});

describe("non-money BIGINT columns", () => {
  it("still come back as bigint", async () => {
    const key = { network: "TEST", tokenContract: `t-${process.hrtime.bigint()}`, receivingAddress: "a" };
    const cursor = await prisma.chainScanCursor.create({
      data: { ...key, lastCommittedTimestampMs: 1_700_000_000_000n, lastScannedBlock: 5n },
    });
    expect(cursor.lastCommittedTimestampMs).toBe(1_700_000_000_000n);
    expect(cursor.lastScannedBlock).toBe(5n);
    await prisma.chainScanCursor.deleteMany({ where: { tokenContract: key.tokenContract } });
  });
});
