import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { dailyLeaderboard } from "./leaderboard";

const tag = `lb-${Date.now()}`;
let assetId = "";
const userIds: string[] = [];
const accountIds: Record<string, string> = {};

const SINCE = new Date("2100-06-01T00:00:00Z").getTime(); // far future so only our seeded trades match

async function makeTrader(key: string, isBot: boolean): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${tag}-${key}@test.local`, passwordHash: "x", isBot, nickname: key, country: "IN" },
  });
  userIds.push(user.id);
  const account = await prisma.account.create({
    data: { userId: user.id, type: "LIVE", currency: "INR", realBalance: 0 },
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

  const today = new Date(SINCE + 3_600_000); // one hour into the window
  const yesterday = new Date(SINCE - 3_600_000); // before the window

  await settledTrade(winner, 20_000, today, "WON");
  await settledTrade(loser, -10_000, today, "LOST");
  await settledTrade(bot, 50_000, today, "WON"); // biggest, but a bot
  await settledTrade(winner, 99_000, yesterday, "WON"); // excluded: before the window
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
      sinceMs: SINCE,
      viewerUserId: userIds[0]!, // winner
      limit: 100,
      includeBots: false,
    });
    const ours = result.entries.filter((e) => Object.values(accountIds).includes(e.accountId));
    expect(ours.map((e) => e.nickname)).toEqual(["winner", "loser"]); // bot excluded, winner first
    expect(ours[0]!.pnlMinor).toBe(20_000); // yesterday's 99k not counted
    expect(result.you.entry?.nickname).toBe("winner");
    expect(result.you.rank).not.toBeNull();
  });

  it("includes bots when asked", async () => {
    const result = await dailyLeaderboard({ sinceMs: SINCE, viewerUserId: "nobody", limit: 100, includeBots: true });
    const ours = result.entries.filter((e) => Object.values(accountIds).includes(e.accountId));
    expect(ours[0]!.nickname).toBe("bot"); // 50k, biggest
    expect(result.you.rank).toBeNull(); // viewer not present
  });
});
