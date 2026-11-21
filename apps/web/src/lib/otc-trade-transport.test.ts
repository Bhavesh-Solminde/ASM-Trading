import { describe, expect, it, vi } from "vitest";
import type { OtcOpenTradeInput, TradeView } from "@asm/contracts";
import { placeOtcOrder, SOCKET_TRADE_TIMEOUT_MS, type PlacedTrade, type SocketTradeChannel } from "./otc-trade-transport";

const order: OtcOpenTradeInput = {
  symbol: "BTCUSDT", direction: "UP", stake: 10000, durationSec: 60, accountId: "1296cdd9-e2c4-48a2-98ce-f0c508b3d5a6",
  idempotencyKey: "1804d515-243f-46b1-98cc-4af6c71a13a7", quoteToken: "1804d515-243f-46b1-98cc-4af6c71a13a8",
};
const trade = { id: "t-1" } as TradeView;
const balances = { realBalance: 90000, bonusBalance: 0 };
const viaHttp: PlacedTrade = { ok: true, result: { trade, balances }, viaSocket: false };

function socket(open: boolean, reply: Awaited<ReturnType<SocketTradeChannel["request"]>>): SocketTradeChannel {
  return { open, request: vi.fn().mockResolvedValue(reply) };
}

describe("placing an OTC trade", () => {
  it("uses the socket's answer and never posts", async () => {
    const post = vi.fn();
    const channel = socket(true, { type: "trade:open:result", idempotencyKey: order.idempotencyKey, trade, balances });
    expect(await placeOtcOrder(order, channel, post)).toEqual({ ok: true, result: { trade, balances }, viaSocket: true });
    expect(channel.request).toHaveBeenCalledWith(order, SOCKET_TRADE_TIMEOUT_MS);
    expect(post).not.toHaveBeenCalled();
  });

  it("treats a refusal over the socket as final, with the engine's message", async () => {
    const post = vi.fn();
    const channel = socket(true, { type: "trade:open:rejected", idempotencyKey: order.idempotencyKey, code: "insufficient_funds", error: "Not enough balance for that stake." });
    expect(await placeOtcOrder(order, channel, post)).toEqual({ ok: false, status: 409, error: "Not enough balance for that stake." });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ["no answer in time", null],
    ["an internal engine failure", { type: "trade:open:rejected" as const, idempotencyKey: order.idempotencyKey, code: "trading_unavailable", error: "Trading is temporarily unavailable." }],
  ])("retries the same order over HTTP after %s", async (_case, reply) => {
    const post = vi.fn().mockResolvedValue(viaHttp);
    expect(await placeOtcOrder(order, socket(true, reply), post)).toEqual(viaHttp);
    expect(post).toHaveBeenCalledWith(order);
  });

  it("posts directly while the socket is down", async () => {
    const post = vi.fn().mockResolvedValue(viaHttp);
    const channel = socket(false, null);
    expect(await placeOtcOrder(order, channel, post)).toEqual(viaHttp);
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("reports an unreachable server without a status, so the caller keeps the key for a retry", async () => {
    const post = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await placeOtcOrder(order, socket(false, null), post)).toEqual({ ok: false, status: 0, error: "Could not reach the server." });
  });
});
