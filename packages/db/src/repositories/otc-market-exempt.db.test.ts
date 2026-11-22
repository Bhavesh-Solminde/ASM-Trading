import { randomUUID } from "node:crypto";
import { MarketWorld } from "@asm/market-sim";
import { afterAll, expect, it } from "vitest";
import { prisma, type DbClient, type DbTransaction } from "../client";
import { finalizeOtcOpen, reserveOtcTrade, settleOtcTrade, type OtcOpenIntent } from "./otc-trade";

afterAll(() => prisma.$disconnect());

it("opens an exempt LIVE trade at the displayed quote and settles real funds without market flow", async () => {
  const world = new MarketWorld(Date.UTC(2026, 5, 1, 10));
  const symbol = "BTCUSDT";
  const market = world.markets.get(symbol)!;
  const displayedPrice = market.summary().lastPrice;
  const before = market.checkpoint();
  const durationSec = 60;
  const expiry = world.time + durationSec * 1000;
  const baseline = MarketWorld.restore(world.checkpoint());
  baseline.advance(expiry);
  const expiryPrice = baseline.markets.get(symbol)!.summary().lastPrice;
  if (displayedPrice === null || expiryPrice === null) throw new Error("BTC market did not produce a quote");
  const direction = expiryPrice > displayedPrice ? "UP" : "DOWN";
  const rolledBack = new Error("Rollback isolated trade fixture");

  await expect(prisma.$transaction(async (tx) => {
    // Keep the fixture command invisible to the shared dev engine's live command queue.
    const client = {
      $transaction: (operation: (transaction: DbTransaction) => unknown) => operation(tx),
    } as DbClient;
    const user = await tx.user.create({
      data: { email: `exempt-${randomUUID()}@test.invalid`, passwordHash: "test-only", marketExempt: true },
    });
    const account = await tx.account.create({
      data: { userId: user.id, type: "LIVE", currency: "INR", realBalance: 100_000 },
    });
    await tx.asset.upsert({
      where: { symbol },
      create: { symbol, displayName: "BTC OTC", kind: "OTC", payoutPct: 92, isOpen: true },
      update: { isOpen: true },
    });

    const command = await reserveOtcTrade({
      actorId: user.id, accountId: account.id, idempotencyKey: randomUUID(), symbol,
      direction, stake: 10_000, durationSec,
    }, client, world.time, undefined, () => displayedPrice);
    const { contract } = command.input as unknown as OtcOpenIntent;
    expect(contract).toMatchObject({ marketExempt: true, accountType: "LIVE" });
    const result = world.open(contract);
    expect(result).toMatchObject({ flowLots: 0, filledLots: 0, contract: { entryPrice: displayedPrice } });
    expect(market.checkpoint()).toEqual(before);
    expect(await finalizeOtcOpen(command.id, result, null, client)).toMatchObject({
      status: "OPEN", entryPrice: displayedPrice, filledLots: 0, stakeFromBonus: 0,
    });
    expect(await tx.account.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ realBalance: 90_000 });

    world.advance(expiry);
    expect(market.checkpoint()).toEqual(baseline.markets.get(symbol)!.checkpoint());
    const settled = world.contracts.get(command.id)!;
    expect(settled).toMatchObject({ status: "WON", exitPrice: expiryPrice, credit: 19_200 });
    expect(await settleOtcTrade(settled, client)).toMatchObject({ status: "WON", pnl: 9_200 });
    expect(await tx.account.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ realBalance: 109_200 });
    expect(await tx.transaction.findMany({ where: { accountId: account.id } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "TRADE_STAKE", amount: -10_000 }),
      expect.objectContaining({ kind: "TRADE_PAYOUT", amount: 19_200 }),
    ]));

    throw rolledBack;
  })).rejects.toBe(rolledBack);
});
