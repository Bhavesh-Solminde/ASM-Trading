import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const userUpsert = vi.fn(async (input) => ({ id: input.create.email }));
  const accountUpsert = vi.fn(async (input) => ({ id: input.create.userId }));
  const standings = {
    findMany: async () => [...rows.values()],
    upsert: vi.fn(async (input) => {
      const email = input.create.accountId;
      rows.set(email, { ...input.create, account: { userId: email, user: { email } } });
    }),
  };
  const tx = {
    $queryRaw: vi.fn(), user: { upsert: userUpsert }, account: { upsert: accountUpsert },
    demoLeaderboardEntry: standings,
  };
  return { rows, tx, userUpsert, accountUpsert };
});
vi.mock("../client", () => ({ prisma: {
  demoLeaderboardEntry: mock.tx.demoLeaderboardEntry,
  $transaction: async (fn: (tx: unknown) => unknown) => fn(mock.tx),
} }));
vi.mock("./account", () => ({ convertMinorBetween: (amount: number, from: string, to: string) => from === to ? amount : Math.round(amount / 80) }));
import { demoLeaderboard, seedDemoLeaderboardProfiles } from "./demo-leaderboard";

beforeEach(() => {
  vi.clearAllMocks();
  mock.rows.clear();
});

const preview = (date: string, displayCurrency = "INR") => demoLeaderboard({ nowMs: Date.parse(date), displayCurrency });

describe("demo leaderboard", () => {
  it("creates twenty disabled profiles and stores positive P/L below ₹15,000 in the snapshot", async () => {
    const result = await preview("2026-11-08T10:00:00Z");
    expect(result.source).toBe("demo");
    expect(result.entries).toHaveLength(20);
    expect(new Set(result.entries.map((entry) => entry.nickname)).size).toBe(20);
    expect(new Set(result.entries.map((entry) => entry.userId)).size).toBe(20);
    expect(result.you).toEqual({ rank: null, entry: null });
    expect(mock.rows.size).toBe(20);
    for (const entry of result.entries) {
      expect(entry.pnlMinor).toBeGreaterThan(0);
      expect(entry.pnlMinor).toBeLessThan(1_500_000);
      expect(entry.nickname).not.toMatch(/example|dummy/i);
      expect(entry.returnPct).toBeGreaterThan(0);
    }
    expect(result.entries.map((entry) => entry.pnlMinor)).toEqual(result.entries.map((entry) => entry.pnlMinor).sort((a, b) => b - a));
    expect(mock.userUpsert).toHaveBeenCalledTimes(20);
    expect(mock.accountUpsert).toHaveBeenCalledTimes(20);
    for (const [input] of mock.userUpsert.mock.calls) {
      expect(input.create).toMatchObject({ isBot: true, liveAccess: false, passwordHash: "disabled:demo-leaderboard" });
      expect(input.where).toMatchObject({ isBot: true, passwordHash: "disabled:demo-leaderboard" });
    }
    for (const [input] of mock.accountUpsert.mock.calls) {
      expect(input.create).toEqual({ userId: input.where.userId_type.userId, type: "DEMO", currency: "INR" });
    }
  });

  it("refreshes the same twenty profiles at IST midnight and leaves their values stable during the day", async () => {
    const morning = await preview("2026-11-08T00:00:00Z");
    const evening = await preview("2026-11-08T18:29:59Z");
    expect(morning).toEqual(evening);
    expect(mock.userUpsert).toHaveBeenCalledTimes(20);

    const midnight = new Date("2026-11-08T18:30:00Z");
    await seedDemoLeaderboardProfiles(midnight);
    const next = await preview(midnight.toISOString());
    expect(next.entries.map((entry) => entry.userId).sort()).toEqual(morning.entries.map((entry) => entry.userId).sort());
    const oldNames = morning.entries.map((entry) => entry.nickname);
    for (const entry of next.entries) {
      const old = morning.entries.find((row) => row.userId === entry.userId)!;
      expect(oldNames).not.toContain(entry.nickname);
      expect(entry.market).not.toBe(old.market);
      expect(entry.pnlMinor).not.toBe(old.pnlMinor);
      expect(entry.returnPct?.toFixed(4)).not.toBe(old.returnPct?.toFixed(4));
    }
    await seedDemoLeaderboardProfiles(midnight);
    expect(mock.userUpsert).toHaveBeenCalledTimes(40);
    expect(mock.rows.size).toBe(20);
  });

  it("converts displayed amounts while keeping return fixed", async () => {
    const inr = await preview("2026-11-08T10:00:00Z");
    const usd = await preview("2026-11-08T10:01:00Z", "USD");
    for (const entry of usd.entries) {
      const original = inr.entries.find((row) => row.userId === entry.userId)!;
      expect(entry.currency).toBe("USD");
      expect(entry.pnlMinor).toBe(Math.round(original.pnlMinor / 80));
      expect(entry.returnPct).toBe(original.returnPct);
    }
  });
});
