/**
 * Daily leaderboard-bot runner.
 *
 * Keeps a fixed roster of 10 bot users (isBot=true, created 2026-10-20) with
 * one LIVE account each. On every run it inserts exactly one settled trade
 * per bot for the IST day being closed. P/L is deterministic from
 * (botIndex, yyyymmdd) so every bot shows a different profit every day,
 * stable across reruns.
 *
 * Idempotent: reruns for the same IST day replace that day's bot trades.
 *
 * Intended to run at the end of each IST trading day (just before 00:00 IST
 * is fine; the script finds the day it is closing). Example cron on an IST
 * host:
 *
 *     55 23 * * *  cd /path/to/asmtrading && pnpm tsx scripts/seed-bot-leaderboard.ts
 *
 * One-off: close a specific day with `--date=YYYY-MM-DD` (IST calendar day).
 *
 *     pnpm tsx scripts/seed-bot-leaderboard.ts --date=2026-10-21
 */

import { randomBytes } from "node:crypto";
import { prisma } from "../packages/db/src/client";

interface BotSpec {
  nn: string;
  firstName: string;
  lastName: string;
}

const BOTS: BotSpec[] = [
  { nn: "01", firstName: "Arjun",  lastName: "Sharma"    },
  { nn: "02", firstName: "Priya",  lastName: "Mehta"     },
  { nn: "03", firstName: "Rohit",  lastName: "Verma"     },
  { nn: "04", firstName: "Sneha",  lastName: "Kapoor"    },
  { nn: "05", firstName: "Vikas",  lastName: "Agarwal"   },
  { nn: "06", firstName: "Anjali", lastName: "Iyer"      },
  { nn: "07", firstName: "Karan",  lastName: "Malhotra"  },
  { nn: "08", firstName: "Divya",  lastName: "Nair"      },
  { nn: "09", firstName: "Rahul",  lastName: "Chowdhury" },
  { nn: "10", firstName: "Pooja",  lastName: "Bhatt"     },
];

const BOT_CREATED_AT_ISO = "2026-10-20T00:00:00.000+05:30";
const LIVE_SEED_BALANCE = 10_000_000; // ₹1,00,000 in paise — plenty of headroom for daily stakes.
const IST_TZ = "Asia/Kolkata";

/** `yyyymmdd` integer for an IST calendar date. */
function istDateKey(d: Date): { key: number; yyyy: number; mm: number; dd: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  return { key: yyyy * 10000 + mm * 100 + dd, yyyy, mm, dd };
}

/** Start of an IST calendar day as a UTC Date (00:00 IST = 18:30 UTC previous day). */
function istDayStart(yyyy: number, mm: number, dd: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${yyyy}-${pad(mm)}-${pad(dd)}T00:00:00.000+05:30`);
}

/** Pulls --date=YYYY-MM-DD out of argv; falls back to the IST day of `now`. */
function targetDay(now: Date): { yyyy: number; mm: number; dd: number; key: number } {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (arg) {
    const [yyyy, mm, dd] = arg.slice("--date=".length).split("-").map(Number);
    if (!yyyy || !mm || !dd) throw new Error(`bad --date value: ${arg}`);
    return { yyyy, mm, dd, key: yyyy * 10000 + mm * 100 + dd };
  }
  // Shift back 30s so a run fired exactly at IST midnight still closes the
  // day that just ended, not the one that just started.
  return istDateKey(new Date(now.getTime() - 30_000));
}

/**
 * Deterministic 32-bit hash → [0, 1). Same (botIndex, yyyymmdd) always
 * returns the same number, so reruns for a given day are stable.
 */
function seededUnit(seed: number): number {
  let x = (seed | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 0x1_0000_0000;
}

interface DailyPlan {
  stake: number;      // paise
  payoutPct: number;  // integer % matching Trade.payoutPct
  won: boolean;
  pnl: number;        // paise, signed
}

/**
 * One trade per bot per day. Stake, payout and win/loss are all drawn from
 * three independent streams seeded off the (bot, day) pair; the mix produces
 * a different signed profit for every bot every day. Roughly 55% of days win
 * so leaderboards are usually dominated by positives but still have losers.
 */
function planFor(botIndex: number, dayKey: number): DailyPlan {
  const base = botIndex * 1_000_003 + dayKey;
  // Stake: ₹1,000 — ₹15,000 (100_000 — 1_500_000 paise), rounded to ₹100.
  const stake = 100_000 + Math.floor(seededUnit(base) * 141) * 10_000;
  // Payout: 70% — 93% (matches the catalogue's payoutMin/payoutMax).
  const payoutPct = 70 + Math.floor(seededUnit(base ^ 0xabc) * 24);
  const won = seededUnit(base ^ 0xdef) < 0.55;
  const pnl = won ? Math.floor((stake * payoutPct) / 100) : -stake;
  return { stake, payoutPct, won, pnl };
}

/**
 * Bots never log in, so `passwordHash` only needs to satisfy the NOT NULL
 * column — a prefixed random blob never matches an argon2 verify and makes
 * the row obviously disabled on inspection.
 */
function disabledHash(): string {
  return `disabled:bot:${randomBytes(24).toString("base64url")}`;
}

async function ensureBot(spec: BotSpec, sharedHash: string): Promise<string> {
  const email = `bot-rn-${spec.nn}@asmtrade.local`;
  const nickname = `${spec.firstName} ${spec.lastName}`;
  const user = await prisma.user.upsert({
    where: { email },
    // Keep the fixed signup date and the bot flag locked across reruns, but
    // reassert the display fields so edits to BOTS take effect.
    update: {
      isBot: true,
      firstName: spec.firstName,
      lastName: spec.lastName,
      nickname,
      country: "IN",
      liveAccess: true,
      emailVerified: true,
      createdAt: new Date(BOT_CREATED_AT_ISO),
    },
    create: {
      email,
      passwordHash: sharedHash,
      role: "USER",
      isBot: true,
      emailVerified: true,
      liveAccess: true,
      firstName: spec.firstName,
      lastName: spec.lastName,
      nickname,
      country: "IN",
      createdAt: new Date(BOT_CREATED_AT_ISO),
    },
    select: { id: true },
  });

  await prisma.account.upsert({
    where: { userId_type: { userId: user.id, type: "LIVE" } },
    update: {},
    create: {
      userId: user.id,
      type: "LIVE",
      currency: "INR",
      realBalance: LIVE_SEED_BALANCE,
      lifecycleStage: "DEPOSITED",
    },
  });

  return user.id;
}

async function pickOpenAssetId(): Promise<string> {
  const asset = await prisma.asset.findFirst({
    where: { isOpen: true },
    orderBy: { symbol: "asc" },
    select: { id: true, basePrice: true },
  });
  if (!asset) throw new Error("no open asset in catalogue — run `pnpm db:seed` first");
  return asset.id;
}

async function main() {
  const now = new Date();
  const day = targetDay(now);
  const dayStart = istDayStart(day.yyyy, day.mm, day.dd);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  // Place the trade at 23:55 IST of the target day — safely inside the IST
  // day's leaderboard window regardless of when exactly cron fires.
  const expiryTs = new Date(dayStart.getTime() + (23 * 3600 + 55 * 60) * 1000);
  const entryTs = new Date(expiryTs.getTime() - 60_000);

  const sharedHash = disabledHash();

  const assetId = await pickOpenAssetId();

  console.log(
    `seed-bot-leaderboard: closing IST day ${day.yyyy}-${String(day.mm).padStart(2, "0")}-${String(day.dd).padStart(2, "0")} ` +
      `(key ${day.key})`,
  );

  const results: Array<{ nickname: string; pnl: number; won: boolean; stake: number }> = [];

  for (let i = 0; i < BOTS.length; i++) {
    const spec = BOTS[i]!;
    const userId = await ensureBot(spec, sharedHash);
    const account = await prisma.account.findFirstOrThrow({
      where: { userId, type: "LIVE" },
      select: { id: true },
    });

    // Clear any trade this script already wrote for this bot on this IST day.
    await prisma.trade.deleteMany({
      where: {
        accountId: account.id,
        entryTs: { gte: dayStart, lt: dayEnd },
      },
    });

    const plan = planFor(i, day.key);
    // Entry/exit prices are cosmetic — leaderboard reads only `pnl` and the
    // settled status. UP+rise for wins, UP+fall for losses, keeps rows
    // self-consistent if anyone inspects them.
    const entryPrice = 1.0;
    const exitPrice = plan.won ? 1.0001 : 0.9999;

    await prisma.trade.create({
      data: {
        accountId: account.id,
        assetId,
        direction: "UP",
        stake: plan.stake,
        payoutPct: plan.payoutPct,
        entryPrice,
        entryTs,
        expiryTs,
        exitPrice,
        status: plan.won ? "WON" : "LOST",
        pnl: plan.pnl,
      },
    });

    results.push({
      nickname: `${spec.firstName} ${spec.lastName}`,
      pnl: plan.pnl,
      won: plan.won,
      stake: plan.stake,
    });
  }

  results.sort((a, b) => b.pnl - a.pnl);
  console.log("\n  Today's bot standings:");
  for (const r of results) {
    const sign = r.pnl >= 0 ? "+" : "−";
    const rupees = (Math.abs(r.pnl) / 100).toFixed(2);
    const stakeRupees = (r.stake / 100).toFixed(2);
    console.log(
      `    ${r.nickname.padEnd(20)}  ${r.won ? "WON " : "LOST"}  stake ₹${stakeRupees.padStart(8)}  pnl ${sign}₹${rupees}`,
    );
  }
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
