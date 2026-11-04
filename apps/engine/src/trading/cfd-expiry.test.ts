import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), transaction: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() }));
vi.mock("@asm/db", () => ({ prisma: { trade: { findMany: mocks.findMany, findUniqueOrThrow: mocks.findUniqueOrThrow, updateMany: mocks.updateMany }, $transaction: mocks.transaction } }));
vi.mock("@asm/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import { CfdDesk } from "./cfd-desk";

it.each([
  ["UP", 102, null, 102, 20000],
  ["UP", 110, null, 102, 20000],
  ["DOWN", 98, null, 98, 20000],
  ["DOWN", 90, null, 98, 20000],
  ["UP", 110, 105, 102, 20000],
  ["DOWN", 90, 95, 98, 20000],
  ["UP", 110, 101, 101, 10000],
  ["DOWN", 90, 99, 99, 10000],
] as const)("automatically caps %s profit at the earlier profit target (%s, %s)", async (direction, price, takeProfit, exitPrice, pnl) => {
  const now = new Date();
  mocks.findMany.mockResolvedValue([{ id: "capped", accountId: "a", direction,
    entryPrice: 100, stake: 10000, stakeFromBonus: 2500, leverage: 100,
    expiryTs: new Date(now.getTime() + 60000), stopLoss: null, takeProfit,
    trailingPct: null, liqPrice: null, peakPnl: 0 }]);
  const update = vi.fn(async () => ({ count: 1 }));
  const credit = vi.fn();
  const treasury = vi.fn();
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { updateMany: update },
    account: { update: credit, findUnique: async () => ({ type: "LIVE" }) },
    houseTreasury: { upsert: treasury } }));
  const notify = vi.fn();
  expect(await new CfdDesk(notify).scanPositions("asset", "BTCUSDT", price, now)).toEqual([
    { tradeId: "capped", accountId: "a", reason: "TAKE_PROFIT", exitPrice, pnl },
  ]);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ exitPrice, pnl, status: "CLOSED" }) }));
  expect(credit).toHaveBeenCalledWith(expect.objectContaining({ data: {
    realBalance: { increment: (10000 + pnl) * .75 },
    bonusBalance: { increment: (10000 + pnl) * .25 },
  } }));
  expect(treasury).toHaveBeenCalledWith(expect.objectContaining({ update: { treasuryMinor: { increment: -pnl } } }));
  expect(notify).toHaveBeenCalledExactlyOnceWith("capped");
});

it.each(["UP", "DOWN"] as const)("caps a manual %s close that beats the automatic scan", async direction => {
  const credit = vi.fn();
  mocks.findUniqueOrThrow.mockResolvedValue({ id: "manual", accountId: "a", direction,
    status: "OPEN", entryPrice: 100, stake: 10000, stakeFromBonus: 0, leverage: 100,
    entryTs: new Date(Date.now() - 60000) });
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { updateMany: vi.fn(async () => ({ count: 1 })) },
    account: { update: credit, findUnique: async () => ({ type: "DEMO" }) } }));
  const result = await new CfdDesk().manualClose("manual", direction === "UP" ? 110 : 90,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 0 }, 0, 60000);
  expect(result.pnl).toBe(20000);
  expect(result.exitPrice).toBe(direction === "UP" ? 102 : 98);
  expect(credit).toHaveBeenCalledWith(expect.objectContaining({ data: {
    realBalance: { increment: 30000 }, bonusBalance: { increment: 0 },
  } }));
});

it("settles expired positions, credits balances and notifies; a failed row does not block later trades", async () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const base = { accountId: "account", direction: "UP", stake: 10000, stakeFromBonus: 0,
    entryPrice: 100, expiryTs: new Date(now.getTime() - 1000), stopLoss: null,
    takeProfit: null, trailingPct: null, liqPrice: 0, peakPnl: 0 };
  mocks.findMany.mockResolvedValue([{ ...base, id: "fail" }, { ...base, id: "ok" }]);
  const update = vi.fn(async () => ({ count: 1 }));
  const credit = vi.fn(async () => {});
  mocks.transaction.mockRejectedValueOnce(new Error("temporary"))
    .mockImplementationOnce(async fn => fn({ trade: { updateMany: update }, account: { update: credit, findUnique: async () => ({ type: "DEMO" }) } }));
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
  expect(result.trade.leverage).toBe(100);
  expect(result.trade.liqPrice).toBeCloseTo(81646.98 * (direction === "LONG" ? .99 : 1.01));
});

it("charges the full spread separately, logs it and credits LIVE treasury", async () => {
  const debit = vi.fn(async () => ({ count: 1 }));
  const ledger = vi.fn(async () => {});
  const treasury = vi.fn(async () => {});
  mocks.transaction.mockImplementationOnce(async fn => fn({
    trade: { create: async ({ data }: any) => ({ ...data, id: "fee-trade", exitPrice: null, closeReason: null, pnl: 0 }) },
    account: { updateMany: debit, findUniqueOrThrow: vi.fn()
      .mockResolvedValueOnce({ type: "LIVE", realBalance: 200000, bonusBalance: 0 })
      .mockResolvedValueOnce({ realBalance: 95000, bonusBalance: 0 }) },
    transaction: { createMany: ledger }, houseTreasury: { upsert: treasury },
  }));
  const result = await new CfdDesk().open({ actorId: "u", accountId: "a", symbol: "BTCUSDT",
    direction: "LONG", stake: 100000, durationSec: 30 }, 81646.98,
    { id: "asset", symbol: "BTCUSDT", spreadBps: 5 },
    { treasuryMinor: 30000000, netExposure: 0, exposureCap: 50000000,
      userDailyPnl: 0, dailyWinCap: 60000, dynamicMaxStake: 150000, isCircuitBroken: false });
  expect(result.trade.spreadFee).toBe(5000);
  expect(result.trade.entryPrice).toBe(81646.98);
  expect(result.trade.leverage).toBe(100);
  expect(result.trade.liqPrice).toBeCloseTo(81646.98 * .99);
  expect(debit).toHaveBeenCalledWith(expect.objectContaining({ data: {
    realBalance: { decrement: 105000 }, bonusBalance: { decrement: 0 },
  } }));
  expect(ledger).toHaveBeenCalledWith({ data: [
    expect.objectContaining({ kind: "TRADE_STAKE", amount: -100000, balanceAfter: 100000 }),
    expect.objectContaining({ kind: "TRADE_FEE", amount: -5000, balanceAfter: 95000 }),
  ] });
  expect(treasury).toHaveBeenCalledWith(expect.objectContaining({ update: { treasuryMinor: { increment: 5000 } } }));
});

it("returns pure gross PnL on a flat close — the opening fee is not re-subtracted at close", async () => {
  const credit = vi.fn(async () => {});
  const update = vi.fn(async () => ({ count: 1 }));
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { updateMany: update },
    account: { update: credit, findUnique: async () => ({ type: "DEMO" }) } }));
  const result = await new CfdDesk().closePosition({ id: "t", accountId: "a", direction: "UP",
    entryPrice: 100, stake: 100000, stakeFromBonus: 0, spreadFee: 50 }, "DURATION", 100, new Date());
  // Flat market close: grossPnl = 0 → displayed pnl = 0. Credited balance is
  // still just the stake back (netReturn = stake + grossPnl = stake).
  expect(result.pnl).toBe(0);
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

it("allows moving a Buy stop into profit, but below the current price", async () => {
  mocks.findUniqueOrThrow.mockResolvedValue({ status: "OPEN", durationSec: 300, direction: "UP", entryPrice: 100 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  await new CfdDesk().modify("t", { stopLoss: 105, takeProfit: 120 }, 110);
  expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "t", status: "OPEN" }, data: { stopLoss: 105, takeProfit: 120 } });
});
it("rejects protection on the wrong side of the current market", async () => {
  mocks.findUniqueOrThrow.mockResolvedValue({ status: "OPEN", durationSec: 300, direction: "DOWN", entryPrice: 100 });
  await expect(new CfdDesk().modify("t", { stopLoss: 90 }, 100)).rejects.toThrow("INVALID_STOPS");
  await expect(new CfdDesk().modify("t", { takeProfit: 110 }, 100)).rejects.toThrow("INVALID_STOPS");
});
it("allows removing protection but refuses a trade that settled during the edit", async () => {
  mocks.findUniqueOrThrow.mockResolvedValue({ status: "OPEN", durationSec: 300, direction: "UP" });
  mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  await new CfdDesk().modify("t", { stopLoss: null, takeProfit: null }, 100);
  await expect(new CfdDesk().modify("t", { stopLoss: 90 }, 100)).rejects.toThrow("TRADE_NOT_OPEN");
});

it.each([
  ["UP", 95, 110, 94, "STOP_LOSS"],
  ["UP", 95, 110, 111, "TAKE_PROFIT"],
  ["DOWN", 105, 90, 106, "STOP_LOSS"],
  ["DOWN", 105, 90, 89, "TAKE_PROFIT"],
] as const)("honors saved %s protection at a crossed level", async (direction, stopLoss, takeProfit, price, reason) => {
  mocks.findMany.mockResolvedValue([{ id: "protected", accountId: "a", direction, stake: 10000,
    spreadFee: 5, stakeFromBonus: 0, entryPrice: 100, expiryTs: new Date(Date.now() + 60000),
    stopLoss, takeProfit, trailingPct: null, liqPrice: null, peakPnl: 0 }]);
  mocks.transaction.mockImplementationOnce(async fn => fn({ trade: { updateMany: async () => ({ count: 1 }) },
    account: { update: async () => {}, findUnique: async () => ({ type: "DEMO" }) } }));
  const result = await new CfdDesk().scanPositions("asset", "BTCUSDT", price, new Date());
  expect(result[0]?.reason).toBe(reason);
});

it.each([["STOP_LOSS", 80623, -21], ["TAKE_PROFIT", 80629, 53]] as const)("settles 100x %s using rounded paisa and credits the wallet", async (reason, exit, expected) => {
  const credit = vi.fn();
  mocks.transaction.mockImplementationOnce(async fn => fn({trade:{updateMany:vi.fn(async()=>({count:1}))},account:{update:credit,findUnique:async()=>({type:"DEMO"})}}));
  const result = await new CfdDesk().closePosition({id:"leveraged",accountId:"demo",direction:"UP",entryPrice:80624.69,stake:10000,stakeFromBonus:0,leverage:100},reason,exit,new Date());
  expect(result.pnl).toBe(expected);
  expect(credit).toHaveBeenCalledWith(expect.objectContaining({data:{realBalance:{increment:10000+expected},bonusBalance:{increment:0}}}));
});
