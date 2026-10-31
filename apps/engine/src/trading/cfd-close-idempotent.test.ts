import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, prisma } from "@asm/db";
import { CfdDesk } from "./cfd-desk";

const RUN = randomUUID();
const SYMBOL = `CFDIDEM_${RUN.slice(0, 8)}`;
let assetId = "";

beforeAll(async () => {
  const asset = await prisma.asset.create({
    data: { symbol: SYMBOL, displayName: SYMBOL, kind: "OTC", basePrice: 100, isOpen: true },
  });
  assetId = asset.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.asset.deleteMany({ where: { symbol: SYMBOL } });
  await prisma.$disconnect();
});

async function openPosition() {
  const user = await prisma.user.create({
    data: { email: `cfd-idem-${RUN}-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 0);
  const demo = accounts.find((a) => a.type === "DEMO")!;
  // The stake (10,000) was debited when the position opened: balance 90,000 left.
  await prisma.account.update({ where: { id: demo.id }, data: { realBalance: 90_000 } });
  const now = new Date();
  const trade = await prisma.trade.create({
    data: {
      accountId: demo.id,
      assetId,
      direction: "UP",
      stake: 10_000,
      stakeFromBonus: 0,
      payoutPct: 0,
      entryPrice: 100,
      entryTs: now,
      expiryTs: new Date(now.getTime() + 60_000),
      status: "OPEN",
      durationSec: 60,
      leverage: 1,
    },
  });
  return { demoId: demo.id, trade };
}

describe("CfdDesk.closePosition idempotency", () => {
  it("pays once when two closes race on the same position", async () => {
    const { demoId, trade } = await openPosition();
    const desk = new CfdDesk();
    const close = () => desk.closePosition(trade, "MANUAL", 100, new Date());

    const results = await Promise.allSettled([close(), close()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toBe("TRADE_NOT_OPEN");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: demoId } });
    expect(account.realBalance).toBe(100_000); // 90,000 + one stake back, not 110,000
  });

  it("refuses a close on a position that is already closed", async () => {
    const { demoId, trade } = await openPosition();
    const desk = new CfdDesk();
    await desk.closePosition(trade, "MANUAL", 100, new Date());
    await expect(desk.closePosition(trade, "MANUAL", 100, new Date())).rejects.toThrow("TRADE_NOT_OPEN");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: demoId } });
    expect(account.realBalance).toBe(100_000);
  });
});
