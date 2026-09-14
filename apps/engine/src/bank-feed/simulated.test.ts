import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSimulatedFeed } from "./simulated";
import type { Credit } from "./types";

const userIds: string[] = [];

// Real timers, not fake: the feed's tick awaits a Prisma round trip, which is
// real I/O the fake-timer clock never advances. A short delay plus a real wait
// keeps the test fast without racing the query.
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function pendingDeposit(): Promise<{ amountInr: number; vpa: string; claimedUtr: string }> {
  const user = await prisma.user.create({
    data: { email: `sf-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userIds.push(user.id);
  const amountInr = 1_000_000 + Math.floor(Date.now() % 900_000);
  const claimedUtr = "528312345678";
  await prisma.deposit.create({
    data: {
      userId: user.id,
      method: "PhonePe",
      amountInr,
      amountUsd: 10_000,
      vpa: "asmtrade.demo1@okaxis",
      checkoutToken: `tok-${randomUUID()}`,
      status: "PENDING_CONFIRMATION",
      claimedUtr,
      correlationId: "cid",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { amountInr, vpa: "asmtrade.demo1@okaxis", claimedUtr };
}

beforeEach(async () => {
  await prisma.deposit.deleteMany({ where: { status: "PENDING_CONFIRMATION" } });
});

afterEach(async () => {
  await prisma.deposit.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createSimulatedFeed", () => {
  it("emits a credit matching a pending deposit", async () => {
    const deposit = await pendingDeposit();
    const seen: Credit[] = [];

    const feed = createSimulatedFeed({ delayMs: 20, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await sleep(200);
    await feed.stop();

    const match = seen.find((c) => c.amountInr === deposit.amountInr);
    expect(match).toBeDefined();
    expect(match!.vpa).toBe(deposit.vpa);
    expect(match!.utr).toBe(deposit.claimedUtr);
  });

  it("emits nothing when no deposit is pending", async () => {
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 20, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await sleep(150);
    await feed.stop();

    expect(seen).toEqual([]);
  });

  it("emits nothing at a failure rate of 1 — the never-credited case", async () => {
    await pendingDeposit();
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 20, failureRate: 1 });
    await feed.start((c) => seen.push(c));
    await sleep(200);
    await feed.stop();

    expect(seen).toEqual([]);
  });

  it("does not re-emit a credit for a deposit it has already served", async () => {
    await pendingDeposit();
    const seen: Credit[] = [];
    const feed = createSimulatedFeed({ delayMs: 20, failureRate: 0 });
    await feed.start((c) => seen.push(c));
    await sleep(200);
    await feed.stop();

    expect(seen.length).toBe(1);
  });
});
