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
