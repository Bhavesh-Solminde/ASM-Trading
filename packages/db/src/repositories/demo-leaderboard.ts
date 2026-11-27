import { randomInt } from "node:crypto";
import { MULTI_MARKETS } from "@asm/market-sim";
import { prisma, type DbTransaction } from "../client";
import { convertMinorBetween } from "./account";
import type { LeaderboardResult } from "./leaderboard";
import { istDay } from "./program-wallet";

const NAMES = [
  "Arjun Sharma", "Priya Mehta", "Rohit Verma", "Sneha Kapoor", "Vikas Agarwal",
  "Anjali Iyer", "Karan Malhotra", "Divya Nair", "Rahul Chowdhury", "Pooja Bhatt",
  "Aditya Rao", "Meera Kulkarni", "Nikhil Desai", "Riya Saxena", "Kabir Sethi",
  "Aditi Joshi", "Varun Bhat", "Sanya Gupta", "Dev Shah", "Ishita Sen",
  "Kunal Batra", "Neha Pandey", "Rohan Menon", "Asha Reddy", "Manav Patel",
  "Tanvi Sood", "Vivek Khanna", "Naina Roy", "Siddharth Jain", "Simran Kaur",
  "Ankit Yadav", "Kavya Mishra", "Akash Pillai", "Zoya Khan", "Harish Naidu",
  "Nandini Bose", "Sameer Ansari", "Maya Iyengar", "Pranav Hegde", "Lakshmi Das",
  "Rajat Arora", "Sakshi Patil", "Aryan Dhawan", "Shruti Ghosh", "Zain Ali",
  "Rekha Shetty", "Kartik Ahuja", "Tara Sinha", "Naveen Chawla", "Farah Qureshi",
  "Neil Fernandes", "Avni Parmar", "Om Prakash", "Jasleen Gill", "Deepak Thakur",
  "Fatima Sheikh", "Dhruv Luthra", "Ananya Dutta", "Ishan Trivedi", "Leela Thomas",
];
const MARKETS = MULTI_MARKETS.map(({ symbol }) => symbol);
const EMAILS = Array.from({ length: 20 }, (_, i) => `leaderboard-demo-${i + 1}@example.invalid`);
const DISABLED_LOGIN = "disabled:demo-leaderboard";

const readStandings = (db: Pick<DbTransaction, "demoLeaderboardEntry">) => db.demoLeaderboardEntry.findMany({
  include: { account: { select: { userId: true, user: { select: { email: true } } } } },
});
type Standings = Awaited<ReturnType<typeof readStandings>>;

function current(rows: Standings, day: string): boolean {
  return rows.length === EMAILS.length && rows.every((row) => row.day >= day);
}

async function standingsFor(now: Date): Promise<Standings> {
  const day = istDay(now);
  const rows = await readStandings(prisma);
  if (current(rows, day)) return rows;

  return prisma.$transaction(async (tx) => {
    // Serialize startup, midnight and first-request retries across processes.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('demo-leaderboard-rotation'))`;
    const previous = await readStandings(tx);
    if (current(previous, day)) return previous;

    const usedNames = new Set(previous.map((row) => row.nickname));
    const availableNames = NAMES.filter((name) => !usedNames.has(name));
    const previousByEmail = new Map(previous.map((row) => [row.account.user.email, row]));

    for (const email of EMAILS) {
      const nickname = availableNames.splice(randomInt(availableNames.length), 1)[0]!;
      const [firstName = "", ...lastNameParts] = nickname.split(" ");
      const lastName = lastNameParts.join(" ");
      const identity = { nickname, firstName, lastName, isBot: true, liveAccess: false, country: "IN" };
      const user = await tx.user.upsert({
        where: {
          email_role_legacySimulated: { email, role: "USER", legacySimulated: false },
          isBot: true, passwordHash: DISABLED_LOGIN,
        },
        update: identity,
        create: { email, passwordHash: DISABLED_LOGIN, ...identity },
        select: { id: true },
      });
      const { id: accountId } = await tx.account.upsert({
        where: { userId_type: { userId: user.id, type: "DEMO" } },
        update: {},
        create: { userId: user.id, type: "DEMO", currency: "INR" },
        select: { id: true },
      });

      const old = previousByEmail.get(email);
      const markets = MARKETS.filter((market) => market !== old?.market);
      const market = markets[randomInt(markets.length)]!;
      let pnlInrMinor: number;
      do { pnlInrMinor = randomInt(100_000, 1_500_000); } while (pnlInrMinor === old?.pnlInrMinor);
      let stakeInrMinor: number;
      do {
        stakeInrMinor = randomInt(4_000_000, 16_000_001);
      } while (old && (pnlInrMinor / stakeInrMinor * 100).toFixed(4) === (old.pnlInrMinor / old.stakeInrMinor * 100).toFixed(4));
      const standing = { day, nickname, market, pnlInrMinor, stakeInrMinor };
      await tx.demoLeaderboardEntry.upsert({
        where: { accountId }, update: standing, create: { accountId, ...standing },
      });
    }

    return readStandings(tx);
  });
}

export async function seedDemoLeaderboardProfiles(now = new Date()): Promise<void> {
  await standingsFor(now);
}

/** Preview amounts are display fixtures, never a balance or settled trade. */
export async function demoLeaderboard(input: {
  nowMs: number; displayCurrency: string;
}): Promise<LeaderboardResult & { source: "demo" }> {
  const rows = await standingsFor(new Date(input.nowMs));
  const entries = rows.map(({ account, accountId, nickname, market, pnlInrMinor, stakeInrMinor }) => ({
    accountId, userId: account.userId, nickname,
    country: "IN", currency: input.displayCurrency,
    pnlMinor: convertMinorBetween(pnlInrMinor, "INR", input.displayCurrency),
    market, returnPct: pnlInrMinor / stakeInrMinor * 100,
  })).sort((a, b) => b.pnlMinor - a.pnlMinor || a.accountId.localeCompare(b.accountId));
  return { source: "demo", entries, you: { rank: null, entry: null } };
}
