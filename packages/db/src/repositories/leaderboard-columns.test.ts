import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ groupBy: vi.fn(), accounts: vi.fn(), assets: vi.fn() }));
vi.mock("../client", () => ({ prisma: {
  trade: { groupBy: mocks.groupBy }, account: { findMany: mocks.accounts }, asset: { findMany: mocks.assets },
} }));
vi.mock("./account", () => ({ convertMinorBetween: (value: number, from: string, to: string) => from === to ? value : Math.round(value / 100) }));
import { dailyLeaderboard } from "./leaderboard";

beforeEach(() => vi.resetAllMocks());

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
    expect(mocks.groupBy.mock.calls[0]?.[0].where.account).toEqual({ type: "LIVE", user: { isBot: false, legacySimulated: false } });
    expect(result.entries[0]).toMatchObject({ market: "GOLD, SILVER", pnlMinor: 2500, returnPct: 10 });
    expect(result.you.entry?.returnPct).toBe(10);
  });

  it("lists all real traders who beat a demo entry, even beyond the real-only limit or when display amounts round to a tie", async () => {
    const real = Array.from({ length: 13 }, (_, i) => `real-${i + 1}`);
    mocks.groupBy.mockResolvedValueOnce(real.map((accountId, index) => ({
      accountId,
      _sum: { pnl: index === 0 ? 1_500_000 : 100_011 - index },
    }))).mockResolvedValueOnce([]);
    mocks.accounts.mockResolvedValue(real.map((id) => ({ id, currency: "INR", userId: id, user: { nickname: id, country: "IN" } })));
    mocks.assets.mockResolvedValue([]);
    const demo = (accountId: string, pnlMinor: number) => ({
      accountId, userId: accountId, nickname: accountId, country: "IN", currency: "INR", pnlMinor,
      market: "GOLD", returnPct: 10,
    });
    const result = await dailyLeaderboard({
      sinceMs: 0, viewerUserId: real[12]!, limit: 10, includeBots: false, displayCurrency: "USD",
      demoEntriesInInr: [demo("demo-high", 1_499_999), demo("demo-low", 100_000)],
    });
    expect(result.entries.map((entry) => entry.accountId)).toEqual([
      real[0], "demo-high", ...real.slice(1, 11), "demo-low", real[11],
    ]);
    expect(result.entries[0]?.pnlMinor).toBe(result.entries[1]?.pnlMinor);
    expect(result.entries[1]).toMatchObject({ market: "GOLD", returnPct: 10, currency: "USD" });
    expect(result.you).toMatchObject({ rank: 15, entry: { accountId: real[12] } });
    expect(mocks.groupBy.mock.calls[1]?.[0].where.accountId.in).toEqual(real);
  });
});
