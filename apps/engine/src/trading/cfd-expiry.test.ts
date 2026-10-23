import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), transaction: vi.fn() }));
vi.mock("@asm/db", () => ({ prisma: { trade: { findMany: mocks.findMany }, $transaction: mocks.transaction } }));
vi.mock("@asm/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import { CfdDesk } from "./cfd-desk";
it("settles expired positions, credits balances and notifies; a failed row does not block later trades", async () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const base = { accountId: "account", direction: "UP", stake: 10000, stakeFromBonus: 0,
    entryPrice: 100, expiryTs: new Date(now.getTime() - 1000), stopLoss: null,
    takeProfit: null, trailingPct: null, liqPrice: 0, peakPnl: 0 };
  mocks.findMany.mockResolvedValue([{ ...base, id: "fail" }, { ...base, id: "ok" }]);
  const update = vi.fn(async () => {});
  const credit = vi.fn(async () => {});
  mocks.transaction.mockRejectedValueOnce(new Error("temporary"))
    .mockImplementationOnce(async fn => fn({ trade: { update }, account: { update: credit, findUnique: async () => ({ type: "DEMO" }) } }));
  const notify = vi.fn(async () => {});
  const result = await new CfdDesk(notify).scanPositions("asset", "BTCUSDT", 101, now);
  expect(result).toEqual([{ tradeId: "ok", accountId: "account", reason: "DURATION", exitPrice: 101, pnl: 100 }]);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED", closeReason: "DURATION" }) }));
  expect(credit).toHaveBeenCalledWith(expect.objectContaining({ data: { realBalance: { increment: 10100 }, bonusBalance: { increment: 0 } } }));
  expect(notify).toHaveBeenCalledExactlyOnceWith("ok");
});

it("notifies the opening balance after the CFD debit commits", async () => {
  const now = new Date();
  const trade = { id: "new", accountId: "account", direction: "UP", stake: 10000,
    entryPrice: 100, entryTs: now, expiryTs: new Date(now.getTime() + 30000),
    exitPrice: null, stopLoss: null, takeProfit: null, trailingPct: null,
    liqPrice: 0, closeReason: null, status: "OPEN", pnl: 0 };
  mocks.transaction.mockImplementationOnce(async fn => fn({
    trade: { create: async () => trade },
    transaction: { createMany: async () => {} },
    account: { updateMany: async () => ({count: 1}), findUniqueOrThrow: vi.fn()
      .mockResolvedValueOnce({ realBalance: 100000, bonusBalance: 0 })
      .mockResolvedValueOnce({ realBalance: 90000, bonusBalance: 0 }) },
  }));
  const opened = vi.fn();
  await new CfdDesk(undefined, opened).open({ actorId: "user", accountId: "account",
    symbol: "BTCUSDT", direction: "LONG", stake: 10000, durationSec: 30 }, 100,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 0 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 0, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false });
  expect(opened).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    balances: { realBalance: 90000, bonusBalance: 0 },
  }), "user");
});

it.each(["LONG", "SHORT"] as const)("opens %s at the published chart price even with configured spread", async (direction) => {
  const create = vi.fn(async ({ data }) => ({ ...data, id: "trade", exitPrice: null, closeReason: null, pnl: 0 }));
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { create }, transaction: { createMany: async () => {} }, account: {
    updateMany: async () => ({count: 1}), findUniqueOrThrow: async () => ({ realBalance: 100000, bonusBalance: 0 }),
  } }));
  const result = await new CfdDesk().open({ actorId: "u", accountId: "a", symbol: "BTCUSDT",
    direction, stake: 10000, durationSec: 30 }, 81646.98,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 5 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 60000, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entryPrice: 81646.98 }) }));
  expect(result.trade.entryPrice).toBe(81646.98);
});

it("charges the full spread separately, logs it and credits LIVE treasury", async () => {
  const debit = vi.fn(async () => ({ count: 1 }));
  const ledger = vi.fn(async () => {});
  const treasury = vi.fn(async () => {});
  mocks.transaction.mockImplementationOnce(async fn => fn({
    trade: { create: async ({ data }: any) => ({ ...data, id: "fee-trade", exitPrice: null, closeReason: null, pnl: 0 }) },
    account: { updateMany: debit, findUniqueOrThrow: vi.fn()
      .mockResolvedValueOnce({ type: "LIVE", realBalance: 200000, bonusBalance: 0 })
      .mockResolvedValueOnce({ realBalance: 99950, bonusBalance: 0 }) },
    transaction: { createMany: ledger }, houseTreasury: { upsert: treasury },
  }));
  const result = await new CfdDesk().open({ actorId: "u", accountId: "a", symbol: "BTCUSDT",
    direction: "LONG", stake: 100000, durationSec: 30 }, 81646.98,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 5 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 0, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false });
  expect(result.trade.spreadFee).toBe(50);
  expect(result.trade.entryPrice).toBe(81646.98);
  expect(debit).toHaveBeenCalledWith(expect.objectContaining({ data: {
    realBalance: { decrement: 100050 }, bonusBalance: { decrement: 0 },
  } }));
  expect(ledger).toHaveBeenCalledWith({ data: [
    expect.objectContaining({ kind: "TRADE_STAKE", amount: -100000, balanceAfter: 100000 }),
    expect.objectContaining({ kind: "TRADE_FEE", amount: -50, balanceAfter: 99950 }),
  ] });
  expect(treasury).toHaveBeenCalledWith(expect.objectContaining({ update: { treasuryMinor: { increment: 50 } } }));
});

it("does not charge the fee twice when a flat trade closes", async () => {
  const credit = vi.fn(async () => {});
  const update = vi.fn(async () => {});
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { update },
    account: { update: credit, findUnique: async () => ({ type: "DEMO" }) } }));
  const result = await new CfdDesk().closePosition({ id: "t", accountId: "a", direction: "UP",
    entryPrice: 100, stake: 100000, stakeFromBonus: 0, spreadFee: 50 }, "DURATION", 100, new Date());
  expect(result.pnl).toBe(-50);
  expect(credit).toHaveBeenCalledWith(expect.objectContaining({ data: {
    realBalance: { increment: 100000 }, bonusBalance: { increment: 0 },
  } }));
});

it("rejects an order when funds cover the investment but not its fee", async () => {
  mocks.transaction.mockImplementationOnce(async fn => fn({ account: {
    findUniqueOrThrow: async () => ({ realBalance: 100000, bonusBalance: 0 }),
  } }));
  await expect(new CfdDesk().open({ actorId: "u", accountId: "a", symbol: "BTCUSDT",
    direction: "SHORT", stake: 100000, durationSec: 30 }, 100,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 5 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 0, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false })).rejects.toThrow("INSUFFICIENT_BALANCE");
});

it.each(["LONG", "SHORT"] as const)("converts percentage stops at execution for %s", async direction => {
  const create = vi.fn(async ({ data }) => ({ ...data, id: "stops", exitPrice: null, closeReason: null, pnl: 0 }));
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { create },
    transaction: { createMany: async () => {} }, account: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ realBalance: 200000, bonusBalance: 0 }),
    } }));
  const result = await new CfdDesk().open({ actorId: "u", accountId: "a", symbol: "BTCUSDT",
    direction, stake: 100000, durationSec: 30, stopLossPct: 10, takeProfitPct: 10 }, 80000,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 5 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 0, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false });
  expect(result.trade.stopLoss).toBeCloseTo(direction === "LONG" ? 72000 : 88000);
  expect(result.trade.takeProfit).toBeCloseTo(direction === "LONG" ? 88000 : 72000);
});
