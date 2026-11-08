import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ live: vi.fn(), demo: vi.fn(), currency: vi.fn().mockResolvedValue("INR") }));
vi.mock("@asm/db", () => ({ dailyLeaderboard: mock.live, demoLeaderboard: mock.demo, leaderboardCurrencyFor: mock.currency }));
import { loadLeaderboard } from "./leaderboard";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("leaderboard mode", () => {
  it("uses only fictional profiles when demo mode is explicitly selected", async () => {
    vi.stubEnv("LEADERBOARD_MODE", "demo");
    mock.demo.mockResolvedValue({ source: "demo", entries: [], you: { rank: null, entry: null } });
    const result = await loadLeaderboard("viewer");
    expect(result.result.source).toBe("demo");
    expect(mock.demo).toHaveBeenCalledWith({ nowMs: expect.any(Number), displayCurrency: "INR" });
    expect(mock.live).not.toHaveBeenCalled();
  });
  it.each(["live", "", "false"])("keeps actual human results with mode %s", async (mode) => {
    vi.stubEnv("LEADERBOARD_MODE", mode);
    await loadLeaderboard("viewer");
    expect(mock.live).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: "viewer", includeBots: false, limit: 10 }));
    expect(mock.demo).not.toHaveBeenCalled();
  });
});
