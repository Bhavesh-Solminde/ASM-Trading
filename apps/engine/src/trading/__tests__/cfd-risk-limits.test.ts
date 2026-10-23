// Step 3 of docs/cfd-revenue-test-handoff.md — risk-limit pipeline.
//
// Exercises the pure risk primitives in @asm/algo + the open-time guards in
// CfdDesk against the isolated asm_cfd_revenue DB. The warehouse model
// loosens or hardens the funnel through this pipeline, so each rail needs its
// own canary.
//
// Run with the same env as cfd-revenue-sim.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@asm/db";
import {
  dynamicMaxStake,
  exposureCap,
  dailyWinCap,
  isDailyCircuitBroken,
} from "@asm/algo";
import { CfdDesk, type AssetConfig, type RiskLimits } from "../cfd-desk";
import { isHardBlocked, userSpreadMultiplier } from "../spread";

const TAG = "CFDRISK";
const USER_ID = randomUUID();
const LIVE_ACCOUNT_ID = randomUUID();
const ASSET_ID = randomUUID();
const INITIAL_BALANCE = 100_000_000;

async function cleanup() {
  await prisma.trade.deleteMany({ where: { accountId: LIVE_ACCOUNT_ID } });
  await prisma.transaction.deleteMany({ where: { accountId: LIVE_ACCOUNT_ID } });
  await prisma.account.deleteMany({ where: { id: LIVE_ACCOUNT_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: `${TAG}_` } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.asset.create({
    data: {
      id: ASSET_ID,
      symbol: `${TAG}_BTCUSD`,
      displayName: `${TAG}_BTCUSD`,
      kind: "REAL",
      assetClass: "CRYPTO",
      feedSource: "BINANCE",
      spreadBps: 5,
      basePrice: 95000,
      isOpen: true,
    },
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: `cfdrisk+${USER_ID.slice(0, 8)}@test.local`,
      passwordHash: "x",
      liveAccess: true,
      emailVerified: true,
    },
  });
  await prisma.account.create({
    data: { id: LIVE_ACCOUNT_ID, userId: USER_ID, type: "LIVE", realBalance: INITIAL_BALANCE, bonusBalance: 0 },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const asset: AssetConfig = { id: ASSET_ID, symbol: `${TAG}_BTCUSD`, spreadBps: 5 };
const desk = new CfdDesk();

function okRisk(): RiskLimits {
  return {
    treasuryMinor: 30_000_000,
    netExposure: 0,
    exposureCap: 2_000_000_00,
    userDailyPnl: 0,
    dailyWinCap: 60_000,
    dynamicMaxStake: 100_000_000,
    isCircuitBroken: false,
  };
}

async function tryOpen(overrides: Partial<RiskLimits>, stake = 100_000, direction: "LONG" | "SHORT" = "LONG") {
  const risk = { ...okRisk(), ...overrides };
  return desk.open(
    { symbol: asset.symbol, direction, stake, durationSec: 60, accountId: LIVE_ACCOUNT_ID, actorId: USER_ID },
    95000,
    asset,
    risk,
  );
}

describe("Risk primitives — @asm/algo/risk", () => {
  it("dynamicMaxStake = min(cap, 1% of treasury)", () => {
    expect(dynamicMaxStake(0)).toBe(0);
    expect(dynamicMaxStake(10_000_000_000)).toBe(100_000_00); // 1% = 1e8 > cap 1e7 → cap
    expect(dynamicMaxStake(30_000_000)).toBe(300_000); // 1% of ₹3 lakh target = ₹3,000
  });

  it("exposureCap tiers up as the crowd grows", () => {
    expect(exposureCap(10)).toBe(500_000_00);
    expect(exposureCap(50)).toBe(2_000_000_00);
    expect(exposureCap(200)).toBe(5_000_000_00);
  });

  it("dailyWinCap = min(cap, 0.2% of treasury)", () => {
    expect(dailyWinCap(30_000_000)).toBe(60_000);
    expect(dailyWinCap(1_000_000_000_000)).toBe(1_000_000);
  });

  it("isDailyCircuitBroken trips at −2% of treasury", () => {
    expect(isDailyCircuitBroken(0, 30_000_000)).toBe(false);
    expect(isDailyCircuitBroken(-600_000, 30_000_000)).toBe(true);
    expect(isDailyCircuitBroken(-500_000, 30_000_000)).toBe(false);
  });

  it("userSpreadMultiplier: 3× at the daily cap, 1× below", () => {
    expect(userSpreadMultiplier(0, 60_000)).toBe(1);
    expect(userSpreadMultiplier(60_000, 60_000)).toBe(3);
  });

  it("isHardBlocked at 2× dailyWinCap", () => {
    expect(isHardBlocked(119_999, 60_000)).toBe(false);
    expect(isHardBlocked(120_000, 60_000)).toBe(true);
  });
});

describe("CfdDesk.open — risk guards", () => {
  it("rejects every open when the circuit breaker is tripped", async () => {
    await expect(tryOpen({ isCircuitBroken: true })).rejects.toThrow("MARKET_UNAVAILABLE");
  });

  it("rejects when the user has crossed the hard-block (2× daily cap)", async () => {
    await expect(tryOpen({ userDailyPnl: 200_000, dailyWinCap: 60_000 })).rejects.toThrow("TRADING_PAUSED");
  });

  it("rejects when the stake exceeds the dynamic max", async () => {
    await expect(tryOpen({ dynamicMaxStake: 50_000 }, 100_000)).rejects.toThrow("STAKE_EXCEEDS_LIMIT");
  });

  it("rejects when the open would push |netExposure| past exposureCap", async () => {
    // Net exposure already at the cap; another LONG puts us over.
    await expect(
      tryOpen({ netExposure: 2_000_000_00, exposureCap: 2_000_000_00 }, 1, "LONG"),
    ).rejects.toThrow("MARKET_UNAVAILABLE");
    // Opposite side pulls us back and is accepted.
    await expect(
      tryOpen({ netExposure: 2_000_000_00, exposureCap: 2_000_000_00 }, 1, "SHORT"),
    ).resolves.toMatchObject({ trade: expect.any(Object) });
  });

  it("accepts an open on the happy path", async () => {
    const res = await tryOpen({});
    expect(res.trade.id).toBeTruthy();
    expect(res.trade.spreadFee).toBe(Math.round((100_000 * 5) / 10000));
  });
});
