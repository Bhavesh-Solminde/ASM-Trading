import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../src/client";

// Shared GARCH tuning, calibrated on BTC/gold: a gentle drift with no
// volatility gusts. GARCH acts in log-return space, so the same three knobs
// give proportionate movement at any price level — from a $0.30 DOGE to a
// 79,000-point Sensex. History: 1e-6 "vibrated" → 1e-8 → 1e-9 → this.
const GARCH = { garchOmega: 0.0000000005, garchAlpha: 0.05, garchBeta: 0.8 } as const;

interface SeedAsset {
  symbol: string;
  displayName: string;
  kind: "REAL" | "OTC";
  /** Resume/synthetic base price. A real feed anchor overrides it quickly. */
  basePrice: number;
  precision: number;
  /** tickSize drives maxTickMove (tickSize × 40 per tick) — keep it ~0.04% of price. */
  tickSize: number;
}

// The tradeable catalogue. REAL assets anchor to a live external feed — crypto
// to Binance's free WebSocket, forex + gold to Twelve Data's REST tier (see
// apps/engine/src/feeds/index.ts for the symbol → provider mapping). OTC assets
// (the India indices — no free feed exists) run fully synthetic. A symbol with
// no feed mapping degrades to a live-looking synthetic chart, never a crash.
//
// displayName is what the trade UI shows; a trailing "(…)" is rendered as a
// small market qualifier next to the pair.
const MARKETS: SeedAsset[] = [
  // 🪙 Crypto — Binance USDT pairs (free, real-time WebSocket).
  { symbol: "BTCUSDT", displayName: "BTC/USDT", kind: "REAL", basePrice: 95_000, precision: 2, tickSize: 1.0 },
  { symbol: "ETHUSDT", displayName: "ETH/USDT", kind: "REAL", basePrice: 3_500, precision: 2, tickSize: 0.1 },
  { symbol: "SOLUSDT", displayName: "SOL/USDT", kind: "REAL", basePrice: 180, precision: 2, tickSize: 0.01 },
  { symbol: "BNBUSDT", displayName: "BNB/USDT", kind: "REAL", basePrice: 600, precision: 2, tickSize: 0.05 },
  { symbol: "XRPUSDT", displayName: "XRP/USDT", kind: "REAL", basePrice: 1.5, precision: 4, tickSize: 0.0001 },
  { symbol: "DOGEUSDT", displayName: "DOGE/USDT", kind: "REAL", basePrice: 0.3, precision: 5, tickSize: 0.00001 },

  // 💱 Forex — Twelve Data (free tier, polled slowly; synthetic covers the gaps).
  { symbol: "EURUSD", displayName: "EUR/USD", kind: "REAL", basePrice: 1.08, precision: 5, tickSize: 0.00001 },
  { symbol: "GBPUSD", displayName: "GBP/USD", kind: "REAL", basePrice: 1.27, precision: 5, tickSize: 0.00001 },
  { symbol: "USDJPY", displayName: "USD/JPY", kind: "REAL", basePrice: 150.0, precision: 3, tickSize: 0.001 },
  { symbol: "USDCHF", displayName: "USD/CHF", kind: "REAL", basePrice: 0.88, precision: 5, tickSize: 0.00001 },
  { symbol: "AUDUSD", displayName: "AUD/USD", kind: "REAL", basePrice: 0.66, precision: 5, tickSize: 0.00001 },
  { symbol: "USDCAD", displayName: "USD/CAD", kind: "REAL", basePrice: 1.36, precision: 5, tickSize: 0.00001 },

  // 🇮🇳 India indices — no free feed; fully synthetic (OTC). Base prices are
  // indicative index levels; tickSize keeps synthetic movement in scale.
  { symbol: "NIFTY50", displayName: "NIFTY 50 (India)", kind: "OTC", basePrice: 24_000, precision: 2, tickSize: 0.5 },
  { symbol: "BANKNIFTY", displayName: "BANK NIFTY (India)", kind: "OTC", basePrice: 52_000, precision: 2, tickSize: 1.0 },
  { symbol: "FINNIFTY", displayName: "FINNIFTY (India)", kind: "OTC", basePrice: 24_500, precision: 2, tickSize: 0.5 },
  { symbol: "SENSEX", displayName: "SENSEX (India)", kind: "OTC", basePrice: 79_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYIT", displayName: "NIFTY IT (India)", kind: "OTC", basePrice: 42_000, precision: 2, tickSize: 1.0 },
  { symbol: "NIFTYMIDCAP100", displayName: "NIFTY MIDCAP 100 (India)", kind: "OTC", basePrice: 57_000, precision: 2, tickSize: 1.0 },
];

async function main() {
  // Original live markets — kept alongside the catalogue above. The update
  // clause deliberately sets neither payout nor structure, so an admin's payout
  // tuning survives a re-seed; only the open flag and GARCH feel are reasserted.
  await prisma.asset.upsert({
    where: { symbol: "BTCUSD" },
    update: { isOpen: true, ...GARCH },
    create: {
      symbol: "BTCUSD",
      displayName: "BTC/USD",
      kind: "REAL",
      payoutPct: 100,
      payoutMin: 60,
      payoutMax: 100,
      basePrice: 95_000,
      precision: 2,
      tickSize: 1.0,
      ...GARCH,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "XAUUSD" },
    update: { isOpen: true, ...GARCH },
    create: {
      symbol: "XAUUSD",
      displayName: "Gold (XAU/USD)",
      kind: "REAL",
      payoutPct: 100,
      payoutMin: 60,
      payoutMax: 100,
      basePrice: 2_650,
      precision: 2,
      tickSize: 0.02,
      ...GARCH,
    },
  });

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
        payoutPct: 100,
        payoutMin: 60,
        payoutMax: 100,
        basePrice: m.basePrice,
        precision: m.precision,
        tickSize: m.tickSize,
        ...GARCH,
      },
    });
  }

  // Legacy OTC pairs — kept for history but closed, so they no longer appear in
  // the trade UI (which lists isOpen assets) or load into the engine. USDJPY is
  // no longer closed here: it is a live forex market in the catalogue above.
  for (const symbol of ["AUDNZD_OTC", "EURUSD_OTC"] as const) {
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

  // 10 funded LIVE test accounts. These are DEMO-ONLY credentials — a single
  // shared, well-known password for convenience, so they must never exist in a
  // real deployment. Balances are integer paise (₹1,00,000 = 10_000_000). The
  // account update clause re-funds them on every seed, so a re-seed is also a
  // clean reset of the test accounts to a known state.
  const TEST_PASSWORD = "asm-demo-test-2026";
  const LIVE_BALANCE = 10_000_000; // ₹1,00,000
  const DEMO_BALANCE = 10_000_000; // ₹1,00,000
  const testHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });

  for (let i = 1; i <= 10; i++) {
    const email = `test${i}@asmtrade.local`;
    const user = await prisma.user.upsert({
      where: { email },
      // Re-grant live access on every seed, but otherwise keep profile changes
      // made during testing. Live access is per-user, so only these test
      // accounts (and anyone granted in the admin panel) can use the LIVE
      // account — it is never opened globally.
      update: { liveAccess: true },
      create: {
        email,
        passwordHash: testHash,
        role: "USER",
        emailVerified: true,
        liveAccess: true,
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
  console.log(`  Test users: ${testUsers} (test1–test10@asmtrade.local)`);
  console.log(`  Shared test password: ${TEST_PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
