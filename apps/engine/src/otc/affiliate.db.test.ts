import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AFFILIATE_DAILY_FLOAT_MINOR, createAffiliate, istDateOf, prisma,
  resetAffiliateAccountFloat,
} from "@asm/db";
import { MarketWorld } from "@asm/market-sim";
import { OtcRuntime } from "./runtime";
import { seedTestReferences } from "./fixtures";
import { resetAffiliateFloats } from "../affiliate-reset";

const enabled = Boolean(process.env.OTC_TEST_DATABASE_URL);
const users: string[] = [];
let runtime: OtcRuntime | null = null;

describe.skipIf(!enabled)("affiliate accounts on the OTC engine", () => {
  beforeAll(async () => {
    const url = new URL(process.env.OTC_TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/otc_integration"
      || process.env.DATABASE_URL !== process.env.OTC_TEST_DATABASE_URL) {
      throw new Error("Isolated affiliate test database required");
    }
  });
  afterEach(async () => {
    await runtime?.stop(false);
    runtime = null;
    await prisma.marketCommand.deleteMany({ where: { worldId: "otc-main" } });
    await prisma.marketExecution.deleteMany({ where: { worldId: "otc-main" } });
    await prisma.otcCandle.deleteMany({ where: { worldId: "otc-main" } });
    await prisma.marketWorldCheckpoint.deleteMany({ where: { id: "otc-main" } });
    await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });

  it("opens, replays and settles both affiliate accounts without changing any of the 30 markets", async () => {
    await seedTestReferences(prisma);
    await prisma.asset.upsert({
      where: { symbol: "BTCUSDT" },
      create: { symbol: "BTCUSDT", displayName: "Bitcoin", kind: "OTC", payoutPct: 92, isOpen: true },
      update: { isOpen: true },
    });
    const affiliate = await createAffiliate({ email: `affiliate-${randomUUID()}@test.invalid`, passwordHash: "test-only" });
    users.push(affiliate.user.id);
    expect(affiliate.user).toMatchObject({ role: "AFFILIATE", liveAccess: true, emailVerified: true });
    expect(affiliate.accounts).toHaveLength(2);
    runtime = await new OtcRuntime(prisma, process.env.OTC_TEST_DATABASE_URL!).start();
    const before = await runtime.checkpoint();
    const baseline = MarketWorld.restore(before);
    const requests = [];
    const trades = [];
    const today = istDateOf(new Date());
    for (const account of affiliate.accounts) {
      expect(account.realBalance).toBe(AFFILIATE_DAILY_FLOAT_MINOR);
      for (const direction of ["UP", "DOWN"] as const) {
        const quote = (await runtime.snapshot("BTCUSDT")).displayQuote!;
        const request = {
          actorId: affiliate.user.id, accountId: account.id, symbol: "BTCUSDT",
          direction, stake: 10_000, durationSec: 60, idempotencyKey: randomUUID(), quoteToken: quote.token,
          ...(direction === "UP" ? { stopLoss: quote.price - 0.01, takeProfit: quote.price + 0.01 } : {}),
        };
        const trade = await runtime.open(request);
        requests.push(request);
        trades.push(trade);
        expect(trade).toMatchObject({ mode: "OTC_FIXED", entryPrice: quote.price, flowLots: 0, filledLots: 0, payoutPct: 92 });
        expect((await runtime.open(request)).id).toBe(trade.id);
      }
      await prisma.account.update({ where: { id: account.id }, data: { lastAffiliateResetAt: new Date(Date.now() - 86_400_000) } });
      const resets = await Promise.all([1, 2].map(() => resetAffiliateAccountFloat({ accountId: account.id, nowIstDate: today })));
      expect(resets.filter(Boolean)).toHaveLength(1);
    }
    expect(await runtime.openTobs()).toEqual({});
    const opened = await runtime.checkpoint();
    baseline.advance(opened.time);
    expect(opened.markets).toEqual(baseline.checkpoint().markets);
    await runtime.stop(false);
    runtime = await new OtcRuntime(prisma, process.env.OTC_TEST_DATABASE_URL!).start();
    for (const request of requests) expect((await runtime.open(request)).status).toBe("OPEN");
    const end = opened.time + 120_000;
    await runtime.advance(end);
    baseline.advance(end);
    const settled = await prisma.trade.findMany({ where: { id: { in: trades.map(trade => trade.id) } } });
    expect(settled).toHaveLength(4);
    expect(settled.every(trade => trade.status !== "OPEN")).toBe(true);
    expect(settled.filter(trade => trade.direction === "UP").every(trade =>
      trade.closeReason === "STOP_LOSS" || trade.closeReason === "TAKE_PROFIT")).toBe(true);
    expect(settled.filter(trade => trade.direction === "DOWN").every(trade => trade.closeReason === "DURATION")).toBe(true);
    expect((await runtime.checkpoint()).markets).toEqual(baseline.checkpoint().markets);
    expect(await runtime.leaderboard()).toEqual(baseline.leaderboard());
    for (const account of affiliate.accounts) {
      const own = settled.filter(trade => trade.accountId === account.id);
      const credit = own.reduce((sum, trade) => sum + trade.stake + trade.pnl, 0);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).realBalance)
        .toBe(AFFILIATE_DAILY_FLOAT_MINOR + credit);
      expect(await prisma.transaction.count({ where: { accountId: account.id, kind: "TRADE_STAKE" } })).toBe(2);
    }
  }, 30_000);

  it("resets the currency-equivalent float once and refuses non-affiliate accounts", async () => {
    const affiliate = await createAffiliate({ email: `reset-${randomUUID()}@test.invalid`, passwordHash: "test-only" });
    users.push(affiliate.user.id);
    const account = affiliate.accounts[0]!;
    await prisma.account.update({ where: { id: account.id }, data: {
      currency: "USD", realBalance: 500, bonusBalance: 200, lastAffiliateResetAt: new Date(Date.now() - 86_400_000),
    } });
    await resetAffiliateFloats(prisma);
    const balance = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(balance).toMatchObject({ realBalance: 10_000, bonusBalance: 0, currency: "USD" });
    const ledger = await prisma.transaction.findMany({ where: { accountId: account.id, refType: "DailyReset" } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: 9300, balanceAfter: 10_000 });
    expect(await resetAffiliateAccountFloat({ accountId: account.id, nowIstDate: istDateOf(new Date()) })).toBe(false);
    await prisma.user.update({ where: { id: affiliate.user.id }, data: { role: "USER" } });
    expect(await resetAffiliateAccountFloat({ accountId: account.id, nowIstDate: "2000-01-01" })).toBe(false);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).realBalance).toBe(10_000);
  });
});
