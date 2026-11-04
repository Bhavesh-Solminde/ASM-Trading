import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeView } from "@asm/contracts";
import { TradeResultBatcher } from "./trade-results";

const trade = (id: string, accountId: string, pnl: number): TradeView => ({
  id, accountId, symbol: "EURUSD", direction: "UP", stake: 10_000, payoutPct: 80, entryPrice: 1, entryTs: 0, expiryTs: 30, exitPrice: 1, status: pnl > 0 ? "WON" : "LOST", pnl,
} as TradeView);

describe("TradeResultBatcher", () => {
  let online: boolean;
  let send: ReturnType<typeof vi.fn<(userId: string, results: import("./trade-results").TradeResult[]) => Promise<void>>>;
  let batcher: TradeResultBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    online = false;
    send = vi.fn(async () => {});
    batcher = new TradeResultBatcher({
      isOnline: () => online,
      liveAccounts: async (ids) => new Map(ids.filter((i) => i.startsWith("live")).map((i) => [i, "INR"])),
      prefs: async () => ({ notifyTrades: true, isBot: false }),
      send,
    });
  });

  it("groups results that settle within 10 seconds into one push", async () => {
    batcher.add("u1", trade("t1", "live-1", 8_000));
    await vi.advanceTimersByTimeAsync(4_000);
    batcher.add("u1", trade("t2", "live-1", -10_000));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toHaveLength(2);
  });

  it("never pushes demo trades", async () => {
    batcher.add("u1", trade("t1", "demo-1", 8_000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when the user came back online before the push fired", async () => {
    batcher.add("u1", trade("t1", "live-1", 8_000));
    online = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips users who turned trade notifications off", async () => {
    batcher = new TradeResultBatcher({
      isOnline: () => false,
      liveAccounts: async (ids) => new Map(ids.map((i) => [i, "INR"])),
      prefs: async () => ({ notifyTrades: false, isBot: false }),
      send,
    });
    batcher.add("u1", trade("t1", "live-1", 8_000));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
  });
});
