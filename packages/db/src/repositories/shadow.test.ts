import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { loadTradeShadow, openTrade, settleTrade } from "./trade";

const RUN = randomUUID();
let assetId = "";
let seq = 0;

beforeAll(async () => {
  const asset = await prisma.asset.upsert({
    where: { symbol: "AUDNZD_OTC" },
    update: {},
    create: { symbol: "AUDNZD_OTC", displayName: "AUD/NZD OTC", kind: "OTC", payoutPct: 100, isOpen: true },
  });
  assetId = asset.id;
});

afterAll(async () => {
  // Cascades to accounts, trades, shadow rows and ledger rows.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function open() {
  seq += 1;
  const user = await prisma.user.create({
    data: { email: `sh-${RUN}-${seq}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  const accountId = accounts.find((a) => a.type === "DEMO")!.id;

  return openTrade({
    accountId,
    assetId,
    direction: "UP",
    stake: 10_000,
    payoutPct: 100,
    entryPrice: 1.175,
    entryTs: new Date(),
    expiryTs: new Date(),
  });
}

describe("shadow ledger", () => {
  it("writes no shadow row when no shadow data is supplied", async () => {
    const { trade } = await open();
    await settleTrade({ tradeId: trade.id, exitPrice: 1.176 });
    expect(await loadTradeShadow(trade.id)).toBeNull();
  });

  it("records the counterfactual when supplied", async () => {
    const { trade } = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.174,
      shadow: {
        honestExitPrice: 1.176,
        biasApplied: -0.00012,
        magnetApplied: -0.00004,
        imbalanceAtEntry: 0.42,
        exposureUp: 500_000,
        exposureDown: 120_000,
        lifecycleStage: "HIGH_VALUE",
      },
    });

    const shadow = await loadTradeShadow(trade.id);
    expect(shadow).not.toBeNull();
    expect(shadow!.shownResult).toBe("LOST");
    expect(shadow!.honestResult).toBe("WON");
    expect(shadow!.honestExitPrice).toBeCloseTo(1.176, 6);
    expect(shadow!.lifecycleStage).toBe("HIGH_VALUE");
  });

  it("computes deltaPips as the gap between shown and honest price", async () => {
    const { trade } = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.174,
      shadow: {
        honestExitPrice: 1.176, biasApplied: 0, magnetApplied: 0,
        imbalanceAtEntry: 0, exposureUp: 0, exposureDown: 0,
        lifecycleStage: "DEPOSITED",
      },
    });
    const shadow = await loadTradeShadow(trade.id);
    expect(Math.abs(shadow!.deltaPips)).toBeGreaterThan(0);
  });

  it("records matching results when bias changed nothing", async () => {
    const { trade } = await open();
    await settleTrade({
      tradeId: trade.id,
      exitPrice: 1.176,
      shadow: {
        honestExitPrice: 1.1761, biasApplied: -0.00001, magnetApplied: 0,
        imbalanceAtEntry: 0.1, exposureUp: 100_000, exposureDown: 90_000,
        lifecycleStage: "DEPOSITED",
      },
    });
    const shadow = await loadTradeShadow(trade.id);
    expect(shadow!.shownResult).toBe("WON");
    expect(shadow!.honestResult).toBe("WON");
  });
});
