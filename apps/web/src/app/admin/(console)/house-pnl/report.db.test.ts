import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { readDailyOtcVault } from "./report";

const RUN = randomUUID();
let n = 0;

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { account: { user: { email: { contains: RUN } } } } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function liveTrader(data: Record<string, unknown>) {
  const user = await prisma.user.create({
    data: { email: `house-pnl-${n++}-${RUN}@test.local`, passwordHash: "x", ...data, accounts: { create: { type: "LIVE", currency: "INR" } } },
    select: { accounts: { select: { id: true } } },
  });
  return user.accounts[0]!.id;
}

describe("readDailyOtcVault (real DB)", () => {
  it("counts regular users and real affiliates, never retired simulated affiliates", async () => {
    // A day well inside the 30-day window, away from "today" so other suites' trades don't land on it.
    const closedAt = new Date(Date.now() - 10 * 86_400_000);
    closedAt.setUTCHours(6, 0, 0, 0); // 11:30 IST, same IST date
    const date = new Date(closedAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const day = async () => (await readDailyOtcVault()).find((d) => d.date === date)!;
    const before = await day();

    const assetId = (await prisma.asset.findFirstOrThrow({ select: { id: true } })).id;
    const lost = (accountId: string) =>
      prisma.trade.create({
        data: {
          accountId, assetId, mode: "OTC_FIXED", direction: "UP", stake: 10_000, pnl: -10_000, payoutPct: 90,
          entryPrice: 1, entryTs: closedAt, expiryTs: closedAt, closedAt, status: "LOST", currency: "INR",
        },
      });
    await lost(await liveTrader({}));
    await lost(await liveTrader({ role: "AFFILIATE" }));
    await lost(await liveTrader({ role: "AFFILIATE", legacySimulated: true, status: "BANNED" }));

    const after = await day();
    expect(after.settled - before.settled).toBe(2);
    expect(after.stakes - before.stakes).toBe(20_000);
    expect(after.profit - before.profit).toBe(20_000);
  });
});
