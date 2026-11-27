import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ live: vi.fn(), demo: vi.fn(), currency: vi.fn().mockResolvedValue("INR") }));
vi.mock("@asm/db", () => ({ dailyLeaderboard: mock.live, demoLeaderboard: mock.demo, leaderboardCurrencyFor: mock.currency }));
import { loadLeaderboard } from "./leaderboard";
const entry = (accountId: string, pnlMinor: number) => ({
  accountId, userId: `user-${accountId}`, nickname: accountId, country: "IN",
  currency: "INR", pnlMinor, market: "BANKNIFTY", returnPct: pnlMinor / 100_000,
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); mock.currency.mockResolvedValue("INR"); });
describe("leaderboard mode", () => {
  it("keeps fictional traders separate from live results and viewer rank in demo mode", async () => {
    vi.stubEnv("LEADERBOARD_MODE", "demo");
    const viewer = entry("viewer", 15_000);
    mock.live.mockResolvedValue({ source: "live", entries: [viewer, entry("real", 5_000)], you: { rank: 1, entry: viewer } });
    mock.demo.mockReturnValue({ source: "demo", entries: [entry("demo", 20_000)], you: { rank: null, entry: null } });
    const result = await loadLeaderboard("viewer");
    expect(result.result.entries.map(({ accountId }) => accountId)).toEqual(["viewer", "real"]);
    expect(result.result.you).toEqual({ rank: 1, entry: viewer });
    expect(result.demo?.entries.map(({ accountId }) => accountId)).toEqual(["demo"]);
    expect(mock.demo).toHaveBeenCalledWith({ nowMs: expect.any(Number), displayCurrency: "INR" });
    expect(mock.live).toHaveBeenCalledWith(expect.objectContaining({ includeBots: false }));
  });
  it.each(["live", "", "false"])("keeps actual human results with mode %s", async (mode) => {
    vi.stubEnv("LEADERBOARD_MODE", mode);
    mock.live.mockResolvedValue({ source: "live", entries: [], you: { rank: null, entry: null } });
    expect((await loadLeaderboard("viewer")).demo).toBeNull();
    expect(mock.live).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: "viewer", includeBots: false, limit: 10 }));
    expect(mock.demo).not.toHaveBeenCalled();
  });
});
