import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { dailyLeaderboard } from "./leaderboard";

const tag = `lb-${Date.now()}`;
let assetId = "";
const userIds: string[] = [];
const BASE = { limit: 100, displayCurrency: "INR" } as const;

function ours(entries: { accountId: string; nickname: string | null }[]): string[] {
  const ids = new Set(Object.values(accountIds));
  return entries.filter((e) => ids.has(e.accountId)).map((e) => e.nickname ?? "");
}
const accountIds: Record<string, string> = {};

const SINCE = new Date("2100-06-01T00:00:00Z").getTime(); // far future so only our seeded trades match

async function makeTrader(
  key: string,
  isBot: boolean,
  opts: { country?: string | null; currency?: string } = {},
): Promise<string> {
  const country = opts.country === undefined ? "IN" : opts.country;
  const user = await prisma.user.create({
    data: { email: `${tag}-${key}@test.local`, passwordHash: "x", isBot, nickname: key, country },
  });
  userIds.push(user.id);
  const account = await prisma.account.create({
    data: { userId: user.id, type: "LIVE", currency: opts.currency ?? "INR", realBalance: 0 },
  });
  accountIds[key] = account.id;
  return account.id;
}

async function settledTrade(accountId: string, pnl: number, expiryTs: Date, status: "WON" | "LOST"): Promise<void> {
  await prisma.trade.create({
    data: {
      accountId,
      assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 100,
      entryPrice: 1,
      entryTs: new Date(expiryTs.getTime() - 60_000),
      expiryTs,
      exitPrice: 1.1,
      status,
      pnl,
    },
  });
}

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ where: { symbol: "AUDNZD_OTC" } })).id;
  const winner = await makeTrader("winner", false);
  const loser = await makeTrader("loser", false);
  const bot = await makeTrader("bot", true);
  // $1,108 (USD cents) must outrank ₹2,039.52 (paise): 110_800 < 203_952 raw.
  const dollar = await makeTrader("dollar", false, { country: "India", currency: "USD" });
  const rupee = await makeTrader("rupee", false, { country: "BD" });
  const abroad = await makeTrader("abroad", false, { country: "PH" });
  const unknown = await makeTrader("unknown", false, { country: null });

  const today = new Date(SINCE + 3_600_000); // one hour into the window
  const yesterday = new Date(SINCE - 3_600_000); // before the window

  await settledTrade(winner, 20_000, today, "WON");
  await settledTrade(loser, -10_000, today, "LOST");
  await settledTrade(bot, 50_000, today, "WON"); // biggest, but a bot
  await settledTrade(winner, 99_000, yesterday, "WON"); // excluded: before the window
  await settledTrade(dollar, 110_800, today, "WON");
  await settledTrade(rupee, 203_952, today, "WON");
  await settledTrade(abroad, 900_000, today, "WON"); // biggest, but outside the region
  await settledTrade(unknown, 800_000, today, "WON"); // no country: not ranked
});

afterAll(async () => {
  await prisma.trade.deleteMany({ where: { accountId: { in: Object.values(accountIds) } } });
  await prisma.account.deleteMany({ where: { id: { in: Object.values(accountIds) } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("dailyLeaderboard", () => {
  it("ranks LIVE accounts by today's realized P/L, excluding bots and prior days", async () => {
    const result = await dailyLeaderboard({
      ...BASE,
      sinceMs: SINCE,
      viewerUserId: userIds[0]!, // winner
      includeBots: false,
    });
    expect(ours(result.entries)).toEqual(["dollar", "rupee", "winner", "loser"]);
    const winner = result.entries.find((e) => e.nickname === "winner")!;
    expect(winner.pnlMinor).toBe(20_000); // yesterday's 99k not counted
    expect(result.you.entry?.nickname).toBe("winner");
    expect(result.you.rank).not.toBeNull();
  });

  it("compares currencies at the fixed rate and reports in the display currency", async () => {
    const inr = await dailyLeaderboard({ ...BASE, sinceMs: SINCE, viewerUserId: "nobody", includeBots: false });
    const dollar = inr.entries.find((e) => e.nickname === "dollar")!;
    expect(dollar).toMatchObject({ currency: "INR", pnlMinor: 110_800 * 100, country: "IN" });

    const usd = await dailyLeaderboard({
      ...BASE,
      displayCurrency: "USD",
      sinceMs: SINCE,
      viewerUserId: "nobody",
      includeBots: false,
    });
    const rupee = usd.entries.find((e) => e.nickname === "rupee")!;
    expect(rupee).toMatchObject({ currency: "USD", pnlMinor: 2_040 });
    expect(ours(usd.entries)).toEqual(["dollar", "rupee", "winner", "loser"]);
  });

  it("keeps traders outside the region, or with no country, off the board", async () => {
    const result = await dailyLeaderboard({
      ...BASE,
      sinceMs: SINCE,
      viewerUserId: userIds.at(-2)!, // abroad
      includeBots: false,
    });
    expect(ours(result.entries)).not.toContain("abroad");
    expect(ours(result.entries)).not.toContain("unknown");
    // The viewer still sees their own P/L, just unranked.
    expect(result.you).toMatchObject({ rank: null, entry: { nickname: "abroad", pnlMinor: 900_000 } });
  });

  it("includes bots when asked", async () => {
    const result = await dailyLeaderboard({ ...BASE, sinceMs: SINCE, viewerUserId: "nobody", includeBots: true });
    expect(ours(result.entries)).toEqual(["dollar", "rupee", "bot", "winner", "loser"]);
    expect(result.you.rank).toBeNull(); // viewer not present
  });
});
