import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../src/client";

async function main() {
  await prisma.asset.upsert({
    where: { symbol: "USDJPY" },
    update: {},
    create: {
      symbol: "USDJPY",
      displayName: "USD/JPY",
      kind: "REAL",
      payoutPct: 100,
      payoutMin: 60,
      payoutMax: 100,
      basePrice: 157.25,
      precision: 3,
      tickSize: 0.001,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "AUDNZD_OTC" },
    update: {},
    create: {
      symbol: "AUDNZD_OTC",
      displayName: "AUD/NZD (OTC)",
      kind: "OTC",
      payoutPct: 100,
      payoutMin: 85,
      payoutMax: 100,
      basePrice: 1.1735,
      precision: 5,
      tickSize: 0.00001,
    },
  });

  await prisma.asset.upsert({
    where: { symbol: "EURUSD_OTC" },
    update: {},
    create: {
      symbol: "EURUSD_OTC",
      displayName: "EUR/USD (OTC)",
      kind: "OTC",
      payoutPct: 100,
      payoutMin: 85,
      payoutMax: 100,
      basePrice: 1.0842,
      precision: 5,
      tickSize: 0.00001,
    },
  });

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
