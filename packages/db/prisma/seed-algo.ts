/**
 * Dev-only seed for algorithm testing. Do NOT run this in production.
 *
 * Creates five users, each carrying a specific algo scenario baked into a
 * synthetic trade history. Every user has a LIVE account with liveAccess=true
 * and a matching cumulativeDeposits so lifecycle stage lands where it should.
 * Password is shared and well-known — only for hand-testing on dev.
 *
 *   1. pre_deposit_user       — LIVE, 0 deposits    → stage PRE_DEPOSIT
 *   2. deposited_calibrated   — small deposit, ~45% win rate over 30 trades
 *   3. deposited_hotstreak    — small deposit, 90% wins → ceiling active
 *   4. highvalue_calm         — deposit above threshold, ~30% win rate
 *   5. highvalue_loser        — deposit above threshold, on an 8+ loss streak
 *
 * Idempotent: reruns update rather than duplicate. Trade history is rebuilt
 * on every run so the scenarios stay reproducible even after real hand-test
 * trades pollute the accounts.
 */

import argon2 from "argon2";
import { prisma } from "../src/client";
import { createAccountsForUser } from "../src/repositories/account";

const PASSWORD = "asm-algo-test-2026";
const DOMAIN = "@algo.asmtrade.local";

// Above DEPOSIT_THRESHOLD_MINOR (50_000 paise = ₹500). Anything ≥ this puts a
// user in HIGH_VALUE. Chosen ~10× the threshold so it also survives a small
// reversal without dropping back to DEPOSITED.
const HIGH_VALUE_DEPOSIT_MINOR = 500_000;
// Below the threshold — a small first-time depositor.
const DEPOSITED_DEPOSIT_MINOR = 20_000;

const LIVE_BALANCE = 10_000_000; // ₹1,00,000 in paise
const DEMO_BALANCE = 10_000_000;

interface Scenario {
  readonly key: string;
  readonly cumulativeDeposits: number;
  readonly lifecycleStage: "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";
  readonly winStreak: number;
  readonly lossStreak: number;
  /** Sequence of trade outcomes to fabricate (oldest first). */
  readonly history: ("WON" | "LOST")[];
}

function runOf(count: number, wonRate: number, seed = 1): ("WON" | "LOST")[] {
  // Deterministic pseudo-random so a re-seed produces the same distribution.
  // A tiny LCG — plenty for a distribution property; not for anything else.
  let state = seed;
  const out: ("WON" | "LOST")[] = [];
  for (let i = 0; i < count; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const r = state / 0x100000000;
    out.push(r < wonRate ? "WON" : "LOST");
  }
  return out;
}

const SCENARIOS: Record<string, Scenario> = {
  pre_deposit_user: {
    key: "pre_deposit_user",
    cumulativeDeposits: 0,
    lifecycleStage: "PRE_DEPOSIT",
    winStreak: 0,
    lossStreak: 0,
    history: [],
  },
  deposited_calibrated: {
    key: "deposited_calibrated",
    cumulativeDeposits: DEPOSITED_DEPOSIT_MINOR,
    lifecycleStage: "DEPOSITED",
    winStreak: 0,
    lossStreak: 0,
    history: runOf(30, 0.45, 11),
  },
  deposited_hotstreak: {
    key: "deposited_hotstreak",
    cumulativeDeposits: DEPOSITED_DEPOSIT_MINOR,
    lifecycleStage: "DEPOSITED",
    // A recent hot streak — ceiling triggers on lifetime rate, not the
    // Account.winStreak column, so we leave that at 0. What matters is
    // the trade history's win density.
    winStreak: 0,
    lossStreak: 0,
    history: runOf(50, 0.9, 22),
  },
  highvalue_calm: {
    key: "highvalue_calm",
    cumulativeDeposits: HIGH_VALUE_DEPOSIT_MINOR,
    lifecycleStage: "HIGH_VALUE",
    winStreak: 0,
    lossStreak: 0,
    history: runOf(40, 0.3, 33),
  },
  highvalue_loser: {
    key: "highvalue_loser",
    cumulativeDeposits: HIGH_VALUE_DEPOSIT_MINOR,
    lifecycleStage: "HIGH_VALUE",
    // Loss streak here is used AS-IS by the controller (Account column,
    // not derived). Setting it to 10 (> MAX_LOSS_STREAK=8) so the loss
    // guard fires visibly. The last 10 entries in history match to keep
    // the DB self-consistent.
    winStreak: 0,
    lossStreak: 10,
    history: [...runOf(20, 0.35, 44), ...Array<"LOST">(10).fill("LOST")],
  },
};

async function ensureUser(email: string, hash: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: { emailVerified: true, liveAccess: true, status: "ACTIVE" },
    create: {
      email,
      passwordHash: hash,
      role: "USER",
      emailVerified: true,
      liveAccess: true,
    },
    select: { id: true },
  });
  try {
    await createAccountsForUser(user.id, DEMO_BALANCE);
  } catch {
    /* accounts already exist */
  }
  return user.id;
}

async function applyScenario(userId: string, s: Scenario, assetId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { cumulativeDeposits: s.cumulativeDeposits },
  });

  const account = await prisma.account.findFirstOrThrow({
    where: { userId, type: "LIVE" },
  });

  // Wipe prior seeded history so the scenario is exactly what this run says.
  // We only delete trades this seed itself owned (recognisable by their
  // synthetic fake entry/expiry pattern is expensive to filter, so we just
  // delete every trade on the account — reasonable for a dev account that
  // is only used for algo tests).
  await prisma.trade.deleteMany({ where: { accountId: account.id } });

  // Fabricate trades. entryTs is spread over the last hour to give
  // account-stats' ordering something to sort by. All settled — status is
  // WON or LOST — so account-stats' `where: { status in ["WON","LOST"] }`
  // returns them.
  const now = Date.now();
  const durationMs = 60_000; // one-minute trades
  const wonCount = s.history.filter((h) => h === "WON").length;
  for (let i = 0; i < s.history.length; i++) {
    const status = s.history[i]!;
    const entryTs = new Date(now - (s.history.length - i) * durationMs);
    const expiryTs = new Date(entryTs.getTime() + durationMs);
    const stake = 10_000; // ₹100 per trade in paise — matches medianStake floor.
    const payoutPct = 87;
    // Signed PnL — WON returns stake*payoutPct/100 profit, LOST is -stake.
    const pnl =
      status === "WON" ? Math.floor((stake * payoutPct) / 100) : -stake;
    await prisma.trade.create({
      data: {
        accountId: account.id,
        assetId,
        direction: "UP",
        stake,
        payoutPct,
        entryPrice: 1.0,
        entryTs,
        expiryTs,
        // Exit price at 1.0001 for wins (UP wins on rise), 0.9999 for losses.
        exitPrice: status === "WON" ? 1.0001 : 0.9999,
        status,
        pnl,
      },
    });
  }

  const settledCount = s.history.length;
  const rollingWinRate = settledCount === 0 ? 0 : wonCount / settledCount;

  await prisma.account.update({
    where: { id: account.id },
    data: {
      realBalance: LIVE_BALANCE,
      bonusBalance: 0,
      lifecycleStage: s.lifecycleStage,
      winStreak: s.winStreak,
      lossStreak: s.lossStreak,
      tradesCount: settledCount,
      rollingWinRate,
      medianStake: 10_000,
    },
  });
}

async function main(): Promise<void> {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // Any real asset will do — the seed's history is synthetic; the real
  // asset's identity is only used as a foreign-key anchor. BTCUSDT is
  // present after the main seed and known to be OPEN.
  const asset = await prisma.asset.findFirstOrThrow({
    where: { symbol: "BTCUSDT" },
    select: { id: true },
  });

  const summary: string[] = [];
  for (const s of Object.values(SCENARIOS)) {
    const email = `${s.key.replace(/_/g, "-")}${DOMAIN}`;
    const uid = await ensureUser(email, hash);
    await applyScenario(uid, s, asset.id);
    summary.push(
      `  ${email.padEnd(48)} stage=${s.lifecycleStage.padEnd(12)} history=${s.history.length} wins=${s.history.filter((h) => h === "WON").length} lossStreak=${s.lossStreak}`,
    );
  }

  console.log(`
  Algo seed complete. Password (DEV ONLY): ${PASSWORD}

${summary.join("\n")}
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
