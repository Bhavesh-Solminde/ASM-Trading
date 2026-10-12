import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { MARKET_CALIBRATIONS } from "@asm/pricing";
import { prisma } from "../src/client";
import { MARKETS } from "../src/catalogue";

// MSM volatility calibration per symbol. The canonical table lives in
// packages/pricing/src/markets.ts (one source of truth with the engine).
// Seeding reads it directly so there is no second place to keep in sync.
const MSM_BY_SYMBOL = new Map(
  MARKET_CALIBRATIONS.map((c) => [c.symbol, c] as const),
);

async function main() {
  // The full catalogue. For managed markets the update clause reasserts the
  // structural fields (name, kind, price scale) so the seed stays the source of
  // truth for market shape — but leaves payout* untouched so admin payout edits
  // survive a re-seed, matching the two originals above.
  for (const m of MARKETS) {
    const calibration = MSM_BY_SYMBOL.get(m.symbol);
    if (!calibration) {
      throw new Error(
        `seed: no MSM calibration in packages/pricing/src/markets.ts for symbol "${m.symbol}"`,
      );
    }
    const msm = {
      msmSigma: calibration.sigma,
      msmM0: calibration.m0,
      intradayProfile: calibration.profile,
    } as const;
    await prisma.asset.upsert({
      where: { symbol: m.symbol },
      update: {
        displayName: m.displayName,
        kind: m.kind,
        assetClass: m.assetClass,
        basePrice: m.basePrice,
        precision: m.precision,
        tickSize: m.tickSize,
        isOpen: true,
        ...msm,
      },
      create: {
        symbol: m.symbol,
        displayName: m.displayName,
        kind: m.kind,
        assetClass: m.assetClass,
        payoutPct: 93,
        payoutMin: 60,
        payoutMax: 93,
        basePrice: m.basePrice,
        precision: m.precision,
        tickSize: m.tickSize,
        ...msm,
      },
    });
  }

  // Legacy assets — kept for history but closed, so they no longer appear in
  // the trade UI (which lists isOpen assets) or load into the engine.
  // BTCUSD was an original pre-catalogue live market; AUDNZD_OTC and
  // EURUSD_OTC were early synthetic pairs. All three are outside the
  // current catalogue and get parked as closed. (XAUUSD was legacy too,
  // now re-opened as the Gold market above.)
  for (const symbol of ["BTCUSD", "AUDNZD_OTC", "EURUSD_OTC"] as const) {
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
