import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../src/client";

async function main() {
  // Live markets — real-anchored crypto and gold. These are the only two
  // assets the platform trades for now; the forex pairs below are closed.
  await prisma.asset.upsert({
    where: { symbol: "BTCUSD" },
    // These are set on update too: existing rows keep their stored values, so a
    // schema-default change never reaches them — only this does. Three knobs tune
    // the feel: garchOmega is the baseline size (lower = slower drift), and
    // garchAlpha+garchBeta are volatility persistence (sum near 1 = bursty
    // clustering; lower = steady, no bursts). 5e-10 + 0.05/0.80 gives a gentle
    // ~$1.7/tick drift on BTC with no gusts. History: 1e-6 "vibrated" (sawtooth
    // of clamped max moves) → 1e-8 → 1e-9 (still lively) → this.
    update: { isOpen: true, garchOmega: 0.0000000005, garchAlpha: 0.05, garchBeta: 0.8 },
    create: {
      symbol: "BTCUSD",
      displayName: "BTC/USD",
      kind: "REAL",
      payoutPct: 100,
      payoutMin: 60,
      payoutMax: 100,
      // Resume price only — the real Twelve Data anchor overrides it quickly.
      basePrice: 95_000,
      precision: 2,
      // tickSize drives maxTickMove (tickSize × 40 ≈ 0.04% of price per tick),
      // keeping synthetic movement in scale with the real BTC price.
      tickSize: 1.0,
      garchOmega: 0.0000000005,
      garchAlpha: 0.05,
      garchBeta: 0.8,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "XAUUSD" },
    update: { isOpen: true, garchOmega: 0.0000000005, garchAlpha: 0.05, garchBeta: 0.8 },
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
      garchOmega: 0.0000000005,
      garchAlpha: 0.05,
      garchBeta: 0.8,
    },
  });

  // Legacy forex pairs — kept for history but closed, so they no longer appear
  // in the trade UI (which lists isOpen assets) or load into the engine.
  for (const symbol of ["USDJPY", "AUDNZD_OTC", "EURUSD_OTC"] as const) {
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

  const assets = await prisma.asset.count();
  console.log(`  Seeded. Assets: ${assets}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
