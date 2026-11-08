import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ users: vi.fn(), userUpsert: vi.fn(), accountUpsert: vi.fn() }));
vi.mock("../client", () => ({ prisma: {
  user: { findMany: mock.users },
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ user: { upsert: mock.userUpsert }, account: { upsert: mock.accountUpsert } }),
} }));
// Keep the test independent of database/config imports; represent a fixed FX rate.
vi.mock("./account", () => ({ convertMinorBetween: (amount: number, from: string, to: string) => from === to ? amount : Math.round(amount / 80) }));
import { DEMO_LEADERBOARD_PROFILES, demoLeaderboard, seedDemoLeaderboardProfiles } from "./demo-leaderboard";

beforeEach(() => {
  vi.clearAllMocks();
  mock.users.mockResolvedValue(DEMO_LEADERBOARD_PROFILES.map((profile, index) => ({
    ...profile, id: `user-${index}`, accounts: [{ id: `account-${index}` }],
  })));
});

const preview = (date: string, displayCurrency = "INR") => demoLeaderboard({ nowMs: Date.parse(date), displayCurrency });

describe("demo leaderboard", () => {
  it("keeps ten persisted identities with positive ₹10,000–₹20,000 daily amounts in rank order", async () => {
    const result = await preview("2026-11-08T10:00:00Z");
    expect(result.source).toBe("demo");
    expect(result.entries).toHaveLength(10);
    expect(new Set(result.entries.map((entry) => entry.userId)).size).toBe(10);
    expect(result.you).toEqual({ rank: null, entry: null });
    for (const entry of result.entries) {
      expect(entry.pnlMinor).toBeGreaterThanOrEqual(1_000_000);
      expect(entry.pnlMinor).toBeLessThanOrEqual(2_000_000);
      expect(entry.returnPct).toBeCloseTo(entry.pnlMinor / 10_000_000 * 100);
    }
    expect(result.entries.map((entry) => entry.pnlMinor)).toEqual(result.entries.map((entry) => entry.pnlMinor).sort((a, b) => b - a));
  });

  it("stays stable during an IST day, then changes amounts without changing identities at IST midnight", async () => {
    const morning = await preview("2026-11-08T00:00:00Z");
    const evening = await preview("2026-11-08T18:29:59Z");
    const next = await preview("2026-11-08T18:30:00Z");
    expect(morning).toEqual(evening);
    expect(next.entries.map((entry) => entry.userId).sort()).toEqual(morning.entries.map((entry) => entry.userId).sort());
    for (const entry of next.entries) {
      expect(entry.pnlMinor).not.toBe(morning.entries.find((old) => old.userId === entry.userId)?.pnlMinor);
    }
  });

  it("converts displayed amounts while keeping return unchanged", async () => {
    const inr = await preview("2026-11-08T10:00:00Z");
    const usd = await preview("2026-11-08T10:00:00Z", "USD");
    for (const entry of usd.entries) {
      const original = inr.entries.find((row) => row.userId === entry.userId)!;
      expect(entry.currency).toBe("USD");
      expect(entry.pnlMinor).toBe(Math.round(original.pnlMinor / 80));
      expect(entry.returnPct).toBe(original.returnPct);
    }
  });

  it("requires the complete seeded roster instead of silently returning fewer than ten", async () => {
    mock.users.mockResolvedValue([]);
    await expect(preview("2026-11-08T10:00:00Z")).rejects.toThrow("must be seeded");
  });

  it("uses idempotent user and DEMO-account upserts with no funded LIVE account", async () => {
    mock.userUpsert.mockResolvedValue({ id: "persisted-user" });
    await seedDemoLeaderboardProfiles();
    await seedDemoLeaderboardProfiles();
    expect(mock.userUpsert).toHaveBeenCalledTimes(20);
    expect(mock.accountUpsert).toHaveBeenCalledTimes(20);
    for (const [input] of mock.userUpsert.mock.calls) {
      expect(input.create).toMatchObject({ isBot: true, liveAccess: false, passwordHash: "disabled:demo-leaderboard" });
      expect(input.update).toMatchObject({ isBot: true, liveAccess: false });
    }
    for (const [input] of mock.accountUpsert.mock.calls) {
      expect(input).toEqual({ where: { userId_type: { userId: "persisted-user", type: "DEMO" } }, update: {}, create: { userId: "persisted-user", type: "DEMO", currency: "INR" } });
    }
  });
});
