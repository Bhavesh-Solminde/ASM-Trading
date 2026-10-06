import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../src/client";

// Flat volatility: alpha+beta=0 removes GARCH clustering (no more "big
// candle, five dojis, big candle" rhythm). omega is the constant per-sec
// log variance; sigma per 5s tick ≈ 3.16e-4, which at NIFTY ~23600 gives
// ~7-8pt candles on the 1-sigma side and realistic 1m bodies in the
// 20-30pt range. GARCH acts in log-return space, so the same number works
// proportionally for every asset — a $0.30 DOGE to a 79,000-point Sensex.
// History: 1e-6 "vibrated" → 1e-8 → 1e-9 → clustering → this.
const GARCH = { garchOmega: 0.00000002, garchAlpha: 0, garchBeta: 0 } as const;

interface SeedAsset {
  symbol: string;
  displayName: string;
  /**
   * All markets are now house-first with full algo authority. The DB `kind`
   * column is retained ("OTC" for every asset) so migrations and admin
   * tooling keep working, but the value has no operational meaning: the
   * engine treats every asset identically — 200-tick cap, self-anchor,
   * no external anchor pull. The distinction is not exposed to end users.
   */
  kind: "OTC";
  /** Resume/synthetic base price. */
  basePrice: number;
  precision: number;
  /** tickSize drives maxTickMove (tickSize × 200 per tick) — keep it ~0.04% of price. */
  tickSize: number;
}

// The tradeable catalogue — exactly 18 assets, all house-first.
// displayName is what the trade UI shows; a trailing "(…)" is rendered as a
// small market qualifier next to the pair.
const MARKETS: SeedAsset[] = [
  // Crypto
  { symbol: "BTCUSDT", displayName: "BTC/USDT", kind: "OTC", basePrice: 95_000, precision: 2, tickSize: 1.0 },
  { symbol: "ETHUSDT", displayName: "ETH/USDT", kind: "OTC", basePrice: 3_500, precision: 2, tickSize: 0.1 },
  { symbol: "SOLUSDT", displayName: "SOL/USDT", kind: "OTC", basePrice: 180, precision: 2, tickSize: 0.01 },
  { symbol: "BNBUSDT", displayName: "BNB/USDT", kind: "OTC", basePrice: 600, precision: 2, tickSize: 0.05 },
  { symbol: "XRPUSDT", displayName: "XRP/USDT", kind: "OTC", basePrice: 1.5, precision: 4, tickSize: 0.0001 },
  { symbol: "DOGEUSDT", displayName: "DOGE/USDT", kind: "OTC", basePrice: 0.3, precision: 5, tickSize: 0.00001 },

  // Forex
  { symbol: "EURUSD", displayName: "EUR/USD", kind: "OTC", basePrice: 1.08, precision: 5, tickSize: 0.00001 },
  { symbol: "GBPUSD", displayName: "GBP/USD", kind: "OTC", basePrice: 1.27, precision: 5, tickSize: 0.00001 },
  { symbol: "USDJPY", displayName: "USD/JPY", kind: "OTC", basePrice: 150.0, precision: 3, tickSize: 0.001 },
  { symbol: "USDCHF", displayName: "USD/CHF", kind: "OTC", basePrice: 0.88, precision: 5, tickSize: 0.00001 },
  { symbol: "AUDUSD", displayName: "AUD/USD", kind: "OTC", basePrice: 0.66, precision: 5, tickSize: 0.00001 },
  { symbol: "USDCAD", displayName: "USD/CAD", kind: "OTC", basePrice: 1.36, precision: 5, tickSize: 0.00001 },

  // India indices
  { symbol: "NIFTY50", displayName: "NIFTY 50 (India)", kind: "OTC", basePrice: 24_000, precision: 2, tickSize: 0.5 },
  { symbol: "BANKNIFTY", displayName: "BANK NIFTY (India)", kind: "OTC", basePrice: 52_000, precision: 2, tickSize: 1.0 },
  { symbol: "FINNIFTY", displayName: "FINNIFTY (India)", kind: "OTC", basePrice: 24_500, precision: 2, tickSize: 0.5 },
  { symbol: "SENSEX", displayName: "SENSEX (India)", kind: "OTC", basePrice: 79_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYIT", displayName: "NIFTY IT (India)", kind: "OTC", basePrice: 42_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYMIDCAP100", displayName: "NIFTY MIDCAP 100 (India)", kind: "OTC", basePrice: 57_000, precision: 2, tickSize: 1.0 },
];

async function main() {
  // The full catalogue. For managed markets the update clause reasserts the
  // structural fields (name, kind, price scale) so the seed stays the source of
  // truth for market shape — but leaves payout* untouched so admin payout edits
  // survive a re-seed, matching the two originals above.
  for (const m of MARKETS) {
    await prisma.asset.upsert({
      where: { symbol: m.symbol },
      update: {
        displayName: m.displayName,
        kind: m.kind,
        basePrice: m.basePrice,
        precision: m.precision,
        tickSize: m.tickSize,
        isOpen: true,
        ...GARCH,
      },
      create: {
        symbol: m.symbol,
        displayName: m.displayName,
        kind: m.kind,
        payoutPct: 93,
        payoutMin: 60,
        payoutMax: 93,
        basePrice: m.basePrice,
        precision: m.precision,
        tickSize: m.tickSize,
        ...GARCH,
      },
    });
  }

  // Legacy assets — kept for history but closed, so they no longer appear in
  // the trade UI (which lists isOpen assets) or load into the engine.
  // BTCUSD and XAUUSD were the original two live markets pre-catalogue;
  // AUDNZD_OTC and EURUSD_OTC were early synthetic pairs. All four are
  // outside the current 18-asset catalogue and get parked as closed.
  for (const symbol of ["BTCUSD", "XAUUSD", "AUDNZD_OTC", "EURUSD_OTC"] as const) {
    await prisma.asset.updateMany({ where: { symbol }, data: { isOpen: false } });
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { email: "admin@asmtrade.local" },
  });

  if (!existingAdmin) {
    // Random password printed once — never a known default, per the threat model.
    const password = randomBytes(12).toString("base64url");
    const admin = await prisma.user.create({
      data: {
        email: "admin@asmtrade.local",
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: "ADMIN",
        emailVerified: true,
      },
    });
    await prisma.account.createMany({
      data: [
        { userId: admin.id, type: "LIVE", realBalance: 0 },
        { userId: admin.id, type: "DEMO", realBalance: 1_000_000 },
      ],
    });
    console.log("\n  Admin created: admin@asmtrade.local");
    console.log(`  Password (shown once): ${password}\n`);
  } else {
    console.log("  Admin already exists — password unchanged.");
  }

  // One funded LIVE test account (test10@asmtrade.local). The other nine were
  // retired when live trading opened to every user — the global gate is gone,
  // so pre-seeded liveAccess bearers are no longer needed. Credentials remain
  // DEMO-ONLY (shared well-known password) and must never exist in a real
  // deployment. Balances are integer paise (₹1,00,000 = 10_000_000). The
  // account update clause re-funds the account on every seed.
  const TEST_PASSWORD = "asm-demo-test-2026";
  const LIVE_BALANCE = 10_000_000; // ₹1,00,000
  const DEMO_BALANCE = 10_000_000; // ₹1,00,000
  const testHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });

  for (const i of [10]) {
    const email = `test${i}@asmtrade.local`;
    const user = await prisma.user.upsert({
      where: { email },
      // Re-grant live access on every seed, but otherwise keep profile changes
      // made during testing. Live access is per-user, so only these test
      // accounts (and anyone granted in the admin panel) can use the LIVE
      // account — it is never opened globally.
      //
      // cumulativeDeposits must match the funded LIVE balance so the
      // controller's `stageFor` derivation puts these accounts in the correct
      // bracket. Without it they resolve to PRE_DEPOSIT (65% target win rate),
      // which is a bootstrap-period bias not meant for the LIVE path and lets
      // test accounts win far more than the house edge allows.
      update: { liveAccess: true, cumulativeDeposits: LIVE_BALANCE },
      create: {
        email,
        passwordHash: testHash,
        role: "USER",
        emailVerified: true,
        liveAccess: true,
        cumulativeDeposits: LIVE_BALANCE,
        nickname: `Test ${i}`,
        country: "IN",
      },
    });

    await prisma.account.upsert({
      where: { userId_type: { userId: user.id, type: "LIVE" } },
      update: { realBalance: LIVE_BALANCE, lifecycleStage: "DEPOSITED" },
      create: {
        userId: user.id,
        type: "LIVE",
        currency: "INR",
        realBalance: LIVE_BALANCE,
        lifecycleStage: "DEPOSITED",
      },
    });

    await prisma.account.upsert({
      where: { userId_type: { userId: user.id, type: "DEMO" } },
      update: { realBalance: DEMO_BALANCE },
      create: { userId: user.id, type: "DEMO", currency: "INR", realBalance: DEMO_BALANCE },
    });
  }

  const [assets, openAssets, testUsers] = await Promise.all([
    prisma.asset.count(),
    prisma.asset.count({ where: { isOpen: true } }),
    prisma.user.count({ where: { email: { endsWith: "@asmtrade.local", startsWith: "test" } } }),
  ]);
  console.log(`  Seeded. Assets: ${assets} (${openAssets} open).`);
  console.log(`  Test users: ${testUsers} (test10@asmtrade.local)`);
  console.log(`  Shared test password: ${TEST_PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
