import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import {
  openTradeRecord,
  settleTrade,
  loadTradeShadow,
  type OpenTradeInput,
  type ShadowInput,
} from "./trade";

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
    data: { email: `shadow-${RUN}-${seq}@test.local`, passwordHash: "x" },
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

const shadow: ShadowInput = {
  honestExitPrice: 1.175_05,
  biasApplied: 0.00001,
  magnetApplied: 0,
  imbalanceAtEntry: 0.4,
  exposureUp: 10_000,
  exposureDown: 0,
  lifecycleStage: "PRE_DEPOSIT",
  pipSize: 0.00001,
  wantedWin: true,
  winProbability: 0.65,
};

describe("shadow ledger", () => {
  it("writes no shadow row when shadow is omitted", async () => {
    const { accountId } = await demoAccount();
    const trade = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });

  it("records shown and honest outcomes", async () => {
    const { accountId } = await demoAccount();
    // Entry at 1.175, UP direction
    // Shown exit above entry → WON, honest exit above entry → WON
    const trade = await openTradeRecord(order(accountId, { direction: "UP", entryPrice: 1.175 }));
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.176,
      shadow: { ...shadow, honestExitPrice: 1.17501 },
    });
    const row = await loadTradeShadow(trade.id);
    expect(row).not.toBeNull();
    expect(row!.shownResult).toBe("WON");
    expect(row!.honestResult).toBe("WON");
    expect(row!.wantedWin).toBe(true);
    expect(row!.winProbability).toBeCloseTo(0.65, 6);
  });

  it("computes deltaPips correctly using pipSize", async () => {
    const { accountId } = await demoAccount();
    const trade = await openTradeRecord(order(accountId, { entryPrice: 1.175 }));
    // shownExit=1.176, honestExit=1.175, pipSize=0.00001 → delta=100 pips
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.176,
      shadow: { ...shadow, honestExitPrice: 1.175, pipSize: 0.00001 },
    });
    const row = await loadTradeShadow(trade.id);
    expect(row).not.toBeNull();
    expect(row!.deltaPips).toBeCloseTo(100, 2);
  });

  it("rolls back the shadow if the trade is already settled (atomicity)", async () => {
    const { accountId } = await demoAccount();
    const trade = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    // Trying to settle again should throw and leave no shadow row.
    await expect(
      settleTrade({ tradeId: trade.id, exitPrice: 1.177, shadow }),
    ).rejects.toThrow();
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });

  it("cascades shadow row when its parent trade is deleted", async () => {
    const { accountId } = await demoAccount();
    const trade = await openTradeRecord(order(accountId));
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176, shadow });
    await prisma.trade.delete({ where: { id: trade.id } });
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });
});
