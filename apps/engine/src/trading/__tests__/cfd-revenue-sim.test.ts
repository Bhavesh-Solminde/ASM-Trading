// Step 1 of the CFD revenue test plan — docs/cfd-revenue-test-handoff.md
//
// Simulates ~100 CFD trades across 5 assets (crypto / forex / gold / index) and
// asserts that the B-book warehouse model's revenue invariants hold against a
// REAL Postgres (the isolated `asm_cfd_revenue` DB, not prod).
//
// Run with:
//   DATABASE_URL="postgresql://solminde@localhost:5433/asm_cfd_revenue" \
//   DIRECT_URL="postgresql://solminde@localhost:5433/asm_cfd_revenue" \
//   pnpm --filter @asm/engine exec vitest run src/trading/__tests__/cfd-revenue-sim.test.ts
//
// Invariants verified here:
//   - House treasury target is seeded at ₹3 lakh (30_000_000 paisa).
//   - Spread fee always moves LIVE paisa to the house (`stake * spreadBps / 10000`).
//   - DEMO trades never touch the house treasury.
//   - LIVE closed trades contribute `spreadFee + (-grossPnl)` to the house.
//   - Displayed/stored payout formula: `pnl = dir × (exit − entry) / entry × stake`
//     clamped at −stake (unleveraged, full-stake-at-risk). The opening spread
//     fee is debited at open and NOT re-subtracted at close (cfd-desk.ts).
//   - Each of the six CloseReason enum values fires at least once in the sim.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@asm/db";
import { CfdDesk, type AssetConfig, type RiskLimits } from "../cfd-desk";

type AssetKind = "REAL" | "OTC";
type AssetClass = "FOREX" | "CRYPTO" | "COMMODITY" | "INDEX";
type FeedSource = "BINANCE" | "TWELVE_DATA" | "SYNTHETIC";
type CloseReason = "DURATION" | "STOP_LOSS" | "TAKE_PROFIT" | "MANUAL" | "LIQUIDATION" | "TRAILING_STOP";

const TAG = "CFDREV";
const USER_ID = randomUUID();
const LIVE_ACCOUNT_ID = randomUUID();
const DEMO_ACCOUNT_ID = randomUUID();

interface SeededAsset {
  id: string;
  symbol: string;
  spreadBps: number;
  feedSource: FeedSource;
  basePrice: number;
}

const ASSET_SPECS: Array<{
  symbol: string;
  kind: AssetKind;
  assetClass: AssetClass;
  feedSource: FeedSource;
  spreadBps: number;
  basePrice: number;
}> = [
  { symbol: `${TAG}_BTCUSD`,  kind: "REAL", assetClass: "CRYPTO",    feedSource: "BINANCE",     spreadBps: 5,  basePrice: 95000 },
  { symbol: `${TAG}_ETHUSDT`, kind: "REAL", assetClass: "CRYPTO",    feedSource: "BINANCE",     spreadBps: 5,  basePrice: 3200  },
  { symbol: `${TAG}_XAUUSD`,  kind: "REAL", assetClass: "COMMODITY", feedSource: "TWELVE_DATA", spreadBps: 10, basePrice: 2650  },
  { symbol: `${TAG}_EURUSD`,  kind: "REAL", assetClass: "FOREX",     feedSource: "TWELVE_DATA", spreadBps: 2,  basePrice: 1.0825 },
  { symbol: `${TAG}_NIFTY50`, kind: "OTC",  assetClass: "INDEX",     feedSource: "SYNTHETIC",   spreadBps: 10, basePrice: 24500 },
];

// A generous risk envelope so no sim trade is blocked by caps — we test
// the warehouse math here, not the risk pipeline (that's Step 3).
const RISK: RiskLimits = {
  treasuryMinor: 0,
  netExposure: 0,
  exposureCap: 100_000_000_000, // 100 crore paisa
  userDailyPnl: 0,
  dailyWinCap: 100_000_000_000,
  dynamicMaxStake: 100_000_000,
  isCircuitBroken: false,
};

const INITIAL_BALANCE = 100_000_000; // ₹10 lakh real-money seed (prisma extension surfaces money as number)

const assets = new Map<string, SeededAsset>();
const desk = new CfdDesk();

async function cleanup() {
  // Order matters — trades FK accounts & assets.
  await prisma.trade.deleteMany({ where: { accountId: { in: [LIVE_ACCOUNT_ID, DEMO_ACCOUNT_ID] } } });
  await prisma.transaction.deleteMany({ where: { accountId: { in: [LIVE_ACCOUNT_ID, DEMO_ACCOUNT_ID] } } });
  await prisma.account.deleteMany({ where: { id: { in: [LIVE_ACCOUNT_ID, DEMO_ACCOUNT_ID] } } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.candle.deleteMany({ where: { asset: { symbol: { startsWith: `${TAG}_` } } } });
  await prisma.asset.deleteMany({ where: { symbol: { startsWith: `${TAG}_` } } });
  await prisma.houseTreasury.deleteMany({ where: { id: 1 } });
}

beforeAll(async () => {
  await cleanup();

  for (const spec of ASSET_SPECS) {
    const row = await prisma.asset.create({
      data: {
        symbol: spec.symbol,
        displayName: spec.symbol,
        kind: spec.kind,
        assetClass: spec.assetClass,
        feedSource: spec.feedSource,
        spreadBps: spec.spreadBps,
        basePrice: spec.basePrice,
        isOpen: true,
        payoutPct: 100,
      },
    });
    assets.set(spec.symbol, {
      id: row.id,
      symbol: row.symbol,
      spreadBps: row.spreadBps,
      feedSource: row.feedSource,
      basePrice: spec.basePrice,
    });
  }

  await prisma.user.create({
    data: {
      id: USER_ID,
      email: `cfdrev+${USER_ID.slice(0, 8)}@test.local`,
      passwordHash: "x",
      liveAccess: true,
      emailVerified: true,
    },
  });

  await prisma.account.createMany({
    data: [
      { id: LIVE_ACCOUNT_ID, userId: USER_ID, type: "LIVE", realBalance: INITIAL_BALANCE, bonusBalance: 0 },
      { id: DEMO_ACCOUNT_ID, userId: USER_ID, type: "DEMO", realBalance: INITIAL_BALANCE, bonusBalance: 0 },
    ],
  });

  await prisma.houseTreasury.create({
    data: { id: 1, treasuryMinor: 0, treasuryTargetMinor: 30_000_000 },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function readTreasury(): Promise<number> {
  const t = await prisma.houseTreasury.findUnique({ where: { id: 1 } });
  return t?.treasuryMinor ?? 0;
}

function assetConfig(symbol: string): AssetConfig {
  const a = assets.get(symbol);
  if (!a) throw new Error(`unseeded asset ${symbol}`);
  return { id: a.id, symbol: a.symbol, spreadBps: a.spreadBps };
}

describe("CFD revenue simulation — Step 1", () => {
  it("seeds HouseTreasury with ₹3 lakh target", async () => {
    const t = await prisma.houseTreasury.findUniqueOrThrow({ where: { id: 1 } });
    expect(t.treasuryTargetMinor).toBe(30_000_000);
    expect(t.treasuryMinor).toBe(0);
  });

  it("opens charge the full spread fee to the house, immediately", async () => {
    const asset = assetConfig(`${TAG}_BTCUSD`); // 5 bps
    const stake = 100_000; // ₹1,000
    const expectedFee = Math.round((stake * asset.spreadBps) / 10000); // 50 paisa
    const before = await readTreasury();

    const { trade } = await desk.open(
      {
        symbol: asset.symbol,
        direction: "LONG",
        stake,
        durationSec: 60,
        accountId: LIVE_ACCOUNT_ID,
        actorId: USER_ID,
      },
      95000,
      asset,
      RISK,
    );

    expect(trade.spreadFee).toBe(expectedFee);
    expect(await readTreasury()).toBe(before + expectedFee);
  });

  it("DEMO opens leave the house treasury untouched", async () => {
    const asset = assetConfig(`${TAG}_ETHUSDT`);
    const stake = 500_000;
    const before = await readTreasury();

    await desk.open(
      {
        symbol: asset.symbol,
        direction: "SHORT",
        stake,
        durationSec: 60,
        accountId: DEMO_ACCOUNT_ID,
        actorId: USER_ID,
      },
      3200,
      asset,
      RISK,
    );

    expect(await readTreasury()).toBe(before);
  });

  it("close PnL formula: pnl = dir × (exit − entry) / entry × stake (gross, fee not re-subtracted)", async () => {
    const asset = assetConfig(`${TAG}_XAUUSD`); // 10 bps
    const stake = 1_000_000; // ₹10,000
    const entry = 2650;
    const { trade } = await desk.open(
      {
        symbol: asset.symbol,
        direction: "LONG",
        stake,
        durationSec: 60,
        accountId: LIVE_ACCOUNT_ID,
        actorId: USER_ID,
      },
      entry,
      asset,
      RISK,
    );
    void trade;

    const exit = entry * 1.02; // +2% move
    const row = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const closed = await desk.closePosition(
      {
        id: row.id,
        accountId: row.accountId,
        direction: row.direction,
        entryPrice: row.entryPrice,
        stake: Number(row.stake),
        spreadFee: row.spreadFee,
        stakeFromBonus: Number(row.stakeFromBonus),
      },
      "MANUAL",
      exit,
      new Date(),
    );

    const expectedGross = Math.round(((exit - entry) / entry) * stake);
    expect(closed.pnl).toBe(expectedGross);
  });

  it("simulates 100 trades across all 5 assets and matches house math exactly", async () => {
    const treasuryBefore = await readTreasury();

    const symbols = ASSET_SPECS.map((s) => s.symbol);
    const durations = [30, 60, 300, 1800, 3600];
    // Deterministic scenarios so the sim is reproducible.
    const scenarios: Array<"TP" | "SL" | "DURATION_WIN" | "DURATION_LOSS" | "LIQ_SHORT" | "TRAIL" | "MANUAL" | "DEMO">
      = ["TP", "SL", "DURATION_WIN", "DURATION_LOSS", "LIQ_SHORT", "TRAIL", "MANUAL", "DEMO"];

    let expectedFees = 0;
    let expectedHouseGross = 0;
    const reasonsSeen = new Set<CloseReason>();

    for (let i = 0; i < 100; i++) {
      const spec = ASSET_SPECS[i % symbols.length]!;
      const asset = assetConfig(spec.symbol);
      const stake = 50_000 + (i % 5) * 10_000; // ₹500 → ₹900
      const scenario = scenarios[i % scenarios.length]!;
      const durationSec = durations[i % durations.length]!;
      const entry = spec.basePrice;
      const isDemo = scenario === "DEMO";
      const accountId = isDemo ? DEMO_ACCOUNT_ID : LIVE_ACCOUNT_ID;
      const direction: "LONG" | "SHORT" =
        scenario === "LIQ_SHORT" ? "SHORT" : i % 2 === 0 ? "LONG" : "SHORT";

      const opened = await desk.open(
        {
          symbol: asset.symbol,
          direction,
          stake,
          durationSec,
          accountId,
          actorId: USER_ID,
          ...(scenario === "SL"
            ? { stopLossPct: 1 }
            : scenario === "TP"
              ? { takeProfitPct: 1 }
              : scenario === "TRAIL"
                ? { stopLossPct: 2, trailingPct: 1 }
                : {}),
        },
        entry,
        asset,
        RISK,
      );
      const spreadFee = opened.trade.spreadFee ?? 0;
      if (!isDemo) expectedFees += spreadFee;

      // Choose exit price + close path to force a specific CloseReason.
      const row = await prisma.trade.findUniqueOrThrow({ where: { id: opened.trade.id } });
      const { reason, exitPrice } = ((): { reason: CloseReason; exitPrice: number } => {
        switch (scenario) {
          case "TP": return { reason: "TAKE_PROFIT", exitPrice: row.takeProfit ?? entry };
          case "SL": return { reason: "STOP_LOSS", exitPrice: row.stopLoss ?? entry };
          case "TRAIL": return { reason: "TRAILING_STOP", exitPrice: row.stopLoss ?? entry };
          case "DURATION_WIN":
            return { reason: "DURATION", exitPrice: direction === "LONG" ? entry * 1.005 : entry * 0.995 };
          case "DURATION_LOSS":
          case "DEMO":
            return { reason: "DURATION", exitPrice: direction === "LONG" ? entry * 0.993 : entry * 1.007 };
          case "LIQ_SHORT":
            return { reason: "LIQUIDATION", exitPrice: row.liqPrice ?? entry * 2 };
          case "MANUAL":
            return { reason: "MANUAL", exitPrice: direction === "LONG" ? entry * 1.002 : entry * 0.998 };
        }
      })();

      const closed = await desk.closePosition(
        {
          id: row.id,
          accountId: row.accountId,
          direction: row.direction,
          entryPrice: row.entryPrice,
          stake: Number(row.stake),
          spreadFee: row.spreadFee,
          stakeFromBonus: Number(row.stakeFromBonus),
        },
        reason,
        exitPrice,
        new Date(),
      );
      reasonsSeen.add(reason);

      // Mirror the house's gross-PnL contribution for LIVE trades.
      if (!isDemo) {
        const isLong = row.direction === "UP";
        const pnlFrac = isLong ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
        const rawPnl = Math.round(pnlFrac * stake);
        const grossPnl = Math.max(rawPnl, -stake);
        expectedHouseGross += -grossPnl;
        // Stored pnl is pure gross (fee was taken at open; see cfd-desk.ts).
        void spreadFee;
        expect(closed.pnl).toBe(grossPnl);
      }
    }

    const treasuryAfter = await readTreasury();
    const delta = treasuryAfter - treasuryBefore;
    expect(delta).toBe(expectedFees + expectedHouseGross);

    // All six close reasons exercised (DEMO uses DURATION so no new entry).
    expect(reasonsSeen).toEqual(
      new Set<CloseReason>(["TAKE_PROFIT", "STOP_LOSS", "TRAILING_STOP", "DURATION", "LIQUIDATION", "MANUAL"]),
    );

    // Spread fees alone are strictly positive — the fee-floor invariant.
    expect(expectedFees).toBeGreaterThan(0);
  });

  it("house target is still ₹3 lakh after the sim (not auto-mutated)", async () => {
    const t = await prisma.houseTreasury.findUniqueOrThrow({ where: { id: 1 } });
    expect(t.treasuryTargetMinor).toBe(30_000_000);
  });
});
