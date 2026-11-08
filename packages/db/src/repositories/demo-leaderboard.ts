import { prisma } from "../client";
import { convertMinorBetween } from "./account";
import type { LeaderboardResult } from "./leaderboard";

/** Fictional development profiles. Reserved addresses cannot receive mail. */
export const DEMO_LEADERBOARD_PROFILES = [
  "Arjun Sharma", "Priya Mehta", "Rohit Verma", "Sneha Kapoor", "Vikas Agarwal",
  "Anjali Iyer", "Karan Malhotra", "Divya Nair", "Rahul Chowdhury", "Pooja Bhatt",
].map((nickname, index) => ({ nickname, email: `leaderboard-demo-${index + 1}@example.invalid` }));

/** Run explicitly during preview startup; never seed fictional LIVE money or trades. */
export async function seedDemoLeaderboardProfiles(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const { nickname, email } of DEMO_LEADERBOARD_PROFILES) {
      const [firstName = "", ...lastName] = nickname.split(" ");
      const identity = { nickname, firstName, lastName: lastName.join(" "), isBot: true, liveAccess: false, country: "IN" };
      const user = await tx.user.upsert({
        where: { email },
        update: identity,
        create: { email, passwordHash: "disabled:demo-leaderboard", ...identity },
        select: { id: true },
      });
      await tx.account.upsert({
        where: { userId_type: { userId: user.id, type: "DEMO" } },
        update: {},
        create: { userId: user.id, type: "DEMO", currency: "INR" },
      });
    }
  });
}

function dailyProfitMinor(day: string, email: string): number {
  let hash = 2166136261;
  for (const char of `${day}:${email}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 1_000_000 + ((hash >>> 0) % 1_000_001); // ₹10,000–₹20,000, always positive.
}

/** Preview amounts are display fixtures, never a balance or settled trade. */
export async function demoLeaderboard(input: {
  nowMs: number; displayCurrency: string;
}): Promise<LeaderboardResult & { source: "demo" }> {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(input.nowMs));
  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_LEADERBOARD_PROFILES.map((profile) => profile.email) }, isBot: true },
    select: {
      id: true, email: true, nickname: true,
      accounts: { where: { type: "DEMO" }, select: { id: true }, take: 1 },
    },
  });
  if (users.length !== DEMO_LEADERBOARD_PROFILES.length || users.some((user) => !user.accounts[0])) {
    throw new Error("Demo leaderboard profiles must be seeded before enabling preview mode.");
  }
  const entries = users.map((user) => {
    const pnlInrMinor = dailyProfitMinor(day, user.email);
    return {
      accountId: user.accounts[0]!.id, userId: user.id, nickname: user.nickname,
      country: "IN", currency: input.displayCurrency,
      pnlMinor: convertMinorBetween(pnlInrMinor, "INR", input.displayCurrency),
      market: "BANKNIFTY",
      returnPct: pnlInrMinor / 10_000_000 * 100, // Illustrative ₹1,00,000 stake.
    };
  }).sort((a, b) => b.pnlMinor - a.pnlMinor || a.userId.localeCompare(b.userId));
  return { source: "demo", entries, you: { rank: null, entry: null } };
}
