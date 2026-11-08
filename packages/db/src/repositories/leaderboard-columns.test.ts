import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ groupBy: vi.fn(), accounts: vi.fn(), assets: vi.fn() }));
vi.mock("../client", () => ({ prisma: {
  trade: { groupBy: mocks.groupBy }, account: { findMany: mocks.accounts }, asset: { findMany: mocks.assets },
} }));
vi.mock("./account", () => ({ convertMinorBetween: (value: number) => value }));
import { dailyLeaderboard } from "./leaderboard";

describe("human leaderboard columns", () => {
  it("reports actual markets and return on settled stakes while excluding bots", async () => {
    mocks.groupBy.mockResolvedValueOnce([{ accountId: "a", _sum: { pnl: 2500 } }])
      .mockResolvedValueOnce([
        { accountId: "a", assetId: "gold", _sum: { stake: 10000 } },
        { accountId: "a", assetId: "silver", _sum: { stake: 15000 } },
      ]);
    mocks.accounts.mockResolvedValue([{ id: "a", currency: "INR", userId: "human", user: { nickname: "Trader", country: "IN" } }]);
    mocks.assets.mockResolvedValue([{ id: "gold", symbol: "GOLD" }, { id: "silver", symbol: "SILVER" }]);
    const result = await dailyLeaderboard({ sinceMs: 0, viewerUserId: "human", limit: 10, includeBots: false, displayCurrency: "INR" });
    expect(mocks.groupBy.mock.calls[0][0].where.account).toEqual({ type: "LIVE", user: { isBot: false } });
    expect(result.entries[0]).toMatchObject({ market: "GOLD, SILVER", pnlMinor: 2500, returnPct: 10 });
    expect(result.you.entry?.returnPct).toBe(10);
  });
});
