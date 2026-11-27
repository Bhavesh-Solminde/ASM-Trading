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
  it("passes the INR demo roster to the real-trader ranker in demo mode", async () => {
    vi.stubEnv("LEADERBOARD_MODE", "demo");
    mock.currency.mockResolvedValue("USD");
    const viewer = entry("viewer", 15_000);
    const demoEntries = [entry("demo", 20_000)];
    const combined = { entries: [...demoEntries, viewer], you: { rank: 2, entry: viewer } };
    mock.live.mockResolvedValue(combined);
    mock.demo.mockResolvedValue({ source: "demo", entries: demoEntries, you: { rank: null, entry: null } });
    expect(await loadLeaderboard("viewer")).toEqual({ currency: "USD", result: combined });
    expect(mock.demo).toHaveBeenCalledWith({ nowMs: expect.any(Number), displayCurrency: "INR" });
    expect(mock.live).toHaveBeenCalledWith(expect.objectContaining({
      includeBots: false, displayCurrency: "USD", demoEntriesInInr: demoEntries,
    }));
  });
  it.each(["live", "", "false"])("keeps actual human results with mode %s", async (mode) => {
    vi.stubEnv("LEADERBOARD_MODE", mode);
    mock.live.mockResolvedValue({ source: "live", entries: [], you: { rank: null, entry: null } });
    await loadLeaderboard("viewer");
    expect(mock.live).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: "viewer", includeBots: false, limit: 10 }));
    expect(mock.demo).not.toHaveBeenCalled();
  });
});
