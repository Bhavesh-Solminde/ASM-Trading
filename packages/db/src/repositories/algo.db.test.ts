import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desiredWinProb, HARD_CEILING, LOSS_GUARD_BASE, TARGETS } from "@asm/algo";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { loadAccountStats } from "./account-stats";
import { AccountNotActive, openTrade } from "./trade";

/**
 * DB-integrated tests for the core trading algorithm.
 *
 * Two things are verified end-to-end against a real Postgres:
 *
 *   1. loadAccountStats + desiredWinProb produce the intended controller
 *      output for each seed scenario (pre-deposit, deposited-calibrated,
 *      deposited-hotstreak, high-value calm, high-value loser).
 *   2. openTrade refuses when User.status is not ACTIVE — the freeze
 *      escape that A1 closes.
 *
 * Each test creates its own throw-away user/account/history so the suite
 * is self-contained (independent from seed-algo.ts). That keeps CI runs
 * from stepping on the seeded dev accounts.
 */

interface Fixture {
  userId: string;
  accountId: string;
  assetId: string;
}

let fixture: Fixture;

async function fabricateHistory(input: {
  accountId: string;
  assetId: string;
  outcomes: readonly ("WON" | "LOST")[];
}): Promise<void> {
  const now = Date.now();
  const dur = 60_000;
  for (let i = 0; i < input.outcomes.length; i++) {
    const status = input.outcomes[i]!;
    const entryTs = new Date(now - (input.outcomes.length - i) * dur);
    const expiryTs = new Date(entryTs.getTime() + dur);
    await prisma.trade.create({
      data: {
        accountId: input.accountId,
        assetId: input.assetId,
        direction: "UP",
        stake: 10_000,
        payoutPct: 87,
        entryPrice: 1.0,
        entryTs,
        expiryTs,
        exitPrice: status === "WON" ? 1.0001 : 0.9999,
        status,
        pnl: status === "WON" ? 8_700 : -10_000,
      },
    });
  }
}

beforeAll(async () => {
  const asset = await prisma.asset.findFirstOrThrow({
    where: { symbol: "BTCUSDT" },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      email: `algo-db-${randomUUID()}@test.local`,
      passwordHash: "x",
      liveAccess: true,
    },
    select: { id: true },
  });
  const accounts = await createAccountsForUser(user.id, 0);
  const live = accounts.find((a) => a.type === "LIVE")!;
  fixture = { userId: user.id, accountId: live.id, assetId: asset.id };
});

afterAll(async () => {
  if (!fixture) return;
  await prisma.transaction.deleteMany({ where: { account: { userId: fixture.userId } } });
  await prisma.trade.deleteMany({ where: { accountId: fixture.accountId } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId: fixture.userId } } });
  await prisma.account.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
});

async function reset(overrides: {
  cumulativeDeposits?: number;
  lifecycleStage?: "PRE_DEPOSIT" | "DEPOSITED" | "HIGH_VALUE";
  winStreak?: number;
  lossStreak?: number;
  realBalance?: number;
  bonusBalance?: number;
  status?: "ACTIVE" | "FLAGGED" | "FROZEN" | "BANNED";
  history?: readonly ("WON" | "LOST")[];
} = {}): Promise<void> {
  await prisma.trade.deleteMany({ where: { accountId: fixture.accountId } });
  await prisma.user.update({
    where: { id: fixture.userId },
    data: {
      cumulativeDeposits: overrides.cumulativeDeposits ?? 0,
      status: overrides.status ?? "ACTIVE",
    },
  });
  await prisma.account.update({
    where: { id: fixture.accountId },
    data: {
      lifecycleStage: overrides.lifecycleStage ?? "PRE_DEPOSIT",
      winStreak: overrides.winStreak ?? 0,
      lossStreak: overrides.lossStreak ?? 0,
      realBalance: overrides.realBalance ?? 1_000_000,
      bonusBalance: overrides.bonusBalance ?? 0,
      medianStake: 10_000,
    },
  });
  if (overrides.history && overrides.history.length > 0) {
    await fabricateHistory({
      accountId: fixture.accountId,
      assetId: fixture.assetId,
      outcomes: overrides.history,
    });
  }
}

describe("desiredWinProb against real seeded scenarios", () => {
  it("pre_deposit — p at PRE_DEPOSIT target with no history", async () => {
    await reset({ lifecycleStage: "PRE_DEPOSIT" });
    const stats = await loadAccountStats(fixture.accountId);
    const out = desiredWinProb(stats);
    expect(out.stage).toBe("PRE_DEPOSIT");
    expect(out.p).toBeCloseTo(TARGETS.PRE_DEPOSIT, 3);
    expect(out.ceilingActive).toBe(false);
  });

  it("deposited_calibrated — 45% observed history keeps p near target", async () => {
    // Exactly 9 wins out of 20 trades = 45%. Matches the DEPOSITED
    // target (0.45), so both the short-window posterior and the lifetime
    // posterior sit on target and the controller shouldn't pull p far
    // in either direction. Interleaving the wins/losses (not clustering
    // them at the start) keeps the recency ordering neutral.
    const history: ("WON" | "LOST")[] = [];
    for (let i = 0; i < 20; i++) {
      // 9 wins in a fixed interleaved pattern: every ~2.2 trades wins.
      history.push(Math.floor((i * 9) / 20) !== Math.floor(((i + 1) * 9) / 20) ? "WON" : "LOST");
    }
    // Sanity check the arithmetic: exactly 9 wins.
    const wins = history.filter((h) => h === "WON").length;
    expect(wins).toBe(9);

    await reset({
      cumulativeDeposits: 20_000, // ₹200: DEPOSITED
      lifecycleStage: "DEPOSITED",
      history,
    });
    const stats = await loadAccountStats(fixture.accountId);
    const out = desiredWinProb(stats);
    expect(out.stage).toBe("DEPOSITED");
    // With observed rate == target, p should be tightly clustered around
    // the target. ±0.05 leaves room for the confidence-dampened
    // correction on a small window.
    expect(out.p).toBeGreaterThan(0.40);
    expect(out.p).toBeLessThan(0.50);
    expect(out.ceilingActive).toBe(false);
  });

  it("deposited_hotstreak — 90% wins engages the ceiling and pulls p down", async () => {
    const history: ("WON" | "LOST")[] = [];
    for (let i = 0; i < 50; i++) history.push(i % 10 < 9 ? "WON" : "LOST"); // 45/50 win
    await reset({
      cumulativeDeposits: 20_000,
      lifecycleStage: "DEPOSITED",
      history,
    });
    const stats = await loadAccountStats(fixture.accountId);
    const out = desiredWinProb(stats);
    // Lifetime posterior is well above HARD_CEILING → ceiling active.
    expect(out.posteriorLife).toBeGreaterThan(HARD_CEILING);
    expect(out.ceilingActive).toBe(true);
    // With this much history confidence saturates and the clamp pulls p
    // aggressively down.
    expect(out.p).toBeLessThan(0.15);
  });

  it("highvalue_loser — 10-loss streak with ceiling INACTIVE fires the loss guard", async () => {
    // Ceiling inactive means posteriorLife stays below HARD_CEILING. A
    // 30-trade, mixed history at ~35% wins keeps posteriorLife well below
    // 0.65; the last 10 losses drive the account.lossStreak column.
    const history: ("WON" | "LOST")[] = [];
    for (let i = 0; i < 20; i++) history.push(i % 3 === 0 ? "WON" : "LOST");
    for (let i = 0; i < 10; i++) history.push("LOST");
    await reset({
      cumulativeDeposits: 500_000, // HIGH_VALUE stage
      lifecycleStage: "HIGH_VALUE",
      lossStreak: 10,
      history,
    });
    const stats = await loadAccountStats(fixture.accountId);
    const out = desiredWinProb(stats);
    expect(out.stage).toBe("HIGH_VALUE");
    expect(out.ceilingActive).toBe(false); // posteriorLife well below 0.65
    // Loss guard should push p to at least LOSS_GUARD_BASE.
    expect(out.p).toBeGreaterThanOrEqual(LOSS_GUARD_BASE);
  });
});

describe("openTrade — A1 status gate", () => {
  it("refuses when the user is FROZEN", async () => {
    await reset({ status: "FROZEN", realBalance: 1_000_000 });
    await expect(
      openTrade({
        accountId: fixture.accountId,
        assetId: fixture.assetId,
        direction: "UP",
        stake: 10_000,
        payoutPct: 87,
        entryPrice: 1.0,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(AccountNotActive);
    // Account status stays FROZEN; no trade row was created.
    const trades = await prisma.trade.count({ where: { accountId: fixture.accountId } });
    expect(trades).toBe(0);
  });

  it("refuses when the user is BANNED", async () => {
    await reset({ status: "BANNED", realBalance: 1_000_000 });
    await expect(
      openTrade({
        accountId: fixture.accountId,
        assetId: fixture.assetId,
        direction: "DOWN",
        stake: 10_000,
        payoutPct: 87,
        entryPrice: 1.0,
        entryTs: new Date(),
        expiryTs: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(AccountNotActive);
  });

  it("allows an ACTIVE user to open normally", async () => {
    await reset({ status: "ACTIVE", realBalance: 1_000_000 });
    const opened = await openTrade({
      accountId: fixture.accountId,
      assetId: fixture.assetId,
      direction: "UP",
      stake: 10_000,
      payoutPct: 87,
      entryPrice: 1.0,
      entryTs: new Date(),
      expiryTs: new Date(Date.now() + 60_000),
    });
    expect(opened.trade.status).toBe("OPEN");
    // Cleanup — otherwise the trade row lingers past afterAll for other suites
    // that use the same fixture user (there aren't any today, but keep the
    // test hermetic).
    await prisma.trade.delete({ where: { id: opened.trade.id } });
  });
});
