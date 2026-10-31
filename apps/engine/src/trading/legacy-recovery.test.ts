import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), refund: vi.fn() }));
vi.mock("@asm/db", async (original) => ({ ...await original<typeof import("@asm/db")>(),
  loadOpenPositions: mocks.load, voidTrade: mocks.refund,
}));
vi.mock("@asm/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
import { TradeDesk } from "./trade-desk";
it("only refunds expired legacy orders and retries a failed refund", async () => {
  mocks.load.mockResolvedValue([
    { tradeId: "expired", expirySec: 90 }, { tradeId: "future", expirySec: 110 },
  ]);
  mocks.refund.mockRejectedValue(new Error("temporary db failure"));
  const desk = new TradeDesk({ all: () => [] } as never, {} as never, {} as never);
  await desk.recoverExpiredLegacy(100);
  await desk.recoverExpiredLegacy(101);
  expect(mocks.refund.mock.calls).toEqual([["expired"], ["expired"]]);
});
it("announces confirmed refunds and updated balances", async () => {
  mocks.load.mockResolvedValue([{ tradeId: "expired", expirySec: 90, assetId: "asset", accountId: "account" }]);
  mocks.refund.mockResolvedValue({ userId: "user", realBalance: 250000, bonusBalance: 0,
    trade: { id: "expired", accountId: "account", entryTs: new Date(0), expiryTs: new Date(90000), status: "REFUNDED", stake: 250000, pnl: 0 } });
  const sendToUser = vi.fn();
  const desk = new TradeDesk({ all: () => [{ id: "asset", symbol: "BTCUSDT" }] } as never,
    { sendToUser } as never, { invalidate: vi.fn() } as never);
  await desk.recoverExpiredLegacy(100);
  expect(sendToUser).toHaveBeenCalledWith("user", expect.objectContaining({ type: "trade:settled", trade: expect.objectContaining({ status: "REFUNDED" }) }));
  expect(sendToUser).toHaveBeenCalledWith("user", { type: "balance:update", accountId: "account", realBalance: 250000, bonusBalance: 0 });
});
