import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({
  convertMinorBetween: (amount: number, from: string, to: string) => from === to ? amount : Math.round(amount / 80),
}));
import { demoLeaderboard } from "./demo-leaderboard";

const preview = (date: string, displayCurrency = "INR") => demoLeaderboard({ nowMs: Date.parse(date), displayCurrency });

describe("demo leaderboard", () => {
  it("ranks 60 distinct fictional traders with varied markets, profits, losses and returns", async () => {
    const result = await preview("2026-11-27T10:00:00Z");
    expect(result.source).toBe("demo");
    expect(result.entries).toHaveLength(60);
    expect(new Set(result.entries.map((entry) => entry.nickname)).size).toBe(60);
    expect(new Set(result.entries.map((entry) => entry.accountId)).size).toBe(60);
    expect(new Set(result.entries.map((entry) => entry.market)).size).toBeGreaterThan(3);
    expect(new Set(result.entries.map((entry) => entry.returnPct)).size).toBeGreaterThan(50);
    expect(result.you).toEqual({ rank: null, entry: null });
    const pnl = result.entries.map((entry) => entry.pnlMinor);
    expect(pnl).toEqual([...pnl].sort((a, b) => b - a));
    expect(pnl[0]).toBeGreaterThan(0);
    expect(pnl.at(-1)).toBeLessThan(0);
    for (const entry of result.entries) {
      expect(Math.sign(entry.returnPct!)).toBe(Math.sign(entry.pnlMinor));
    }
  });

  it("rotates at IST midnight and repeats the daily results exactly after 60 days", async () => {
    const morning = await preview("2026-11-27T00:00:00Z");
    const evening = await preview("2026-11-27T18:29:59Z");
    const next = await preview("2026-11-27T18:30:00Z");
    expect(morning).toEqual(evening);
    expect(next.entries.map((entry) => entry.nickname).sort()).toEqual(morning.entries.map((entry) => entry.nickname).sort());
    expect(next).not.toEqual(morning);
    expect(await preview("2027-01-25T18:29:59Z")).not.toEqual(morning);
    expect(await preview("2027-01-25T18:30:00Z")).toEqual(morning);
    expect(await preview("2027-01-26T18:30:00Z")).toEqual(next);
  });

  it("converts displayed amounts while keeping return unchanged", async () => {
    const inr = await preview("2026-11-27T10:00:00Z");
    const usd = await preview("2026-11-27T10:00:00Z", "USD");
    for (const entry of usd.entries) {
      const original = inr.entries.find((row) => row.accountId === entry.accountId)!;
      expect(entry.currency).toBe("USD");
      expect(entry.pnlMinor).toBe(Math.round(original.pnlMinor / 80));
      expect(entry.returnPct).toBe(original.returnPct);
    }
  });
});
