/**
 * Dev-only seed for the admin Approvals screen. Do NOT run this in production.
 *
 * Puts a handful of PENDING_CONFIRMATION deposits and REQUESTED withdrawals
 * on the queue so the admin can see how the panel renders and rehearse the
 * approve/reject flow. Rows are tagged with a fixed correlationId prefix so
 * the seed is idempotent — a rerun wipes the previously-seeded rows and
 * writes fresh ones.
 *
 * One of the deposits carries a screenshotUrl (a public Cloudinary sample)
 * so the "view screenshot" affordance in the admin panel is visible without
 * having to actually walk the user checkout flow.
 */

import argon2 from "argon2";
import { prisma } from "../src/client";
import { createAccountsForUser } from "../src/repositories/account";

const PASSWORD = "asm-approvals-demo-2026";
const EMAIL = "approvals-demo@asm.local";
const CORRELATION_TAG = "seed-approvals-demo";
const DEMO_BALANCE_INR = 10_000_000; // ₹1,00,000 in paise — enough to cover the withdrawal requests

// A publicly-hosted Cloudinary sample image. Swap this later for a real
// screenshot if you want the demo to look more like a UPI receipt.
const SAMPLE_SCREENSHOT_URL =
  "https://res.cloudinary.com/demo/image/upload/w_600,h_800,c_fit/samples/landscapes/architecture-signs.jpg";

interface SeedDeposit {
  method: string;
  amountInrMinor: number;
  claimedUtr: string;
  screenshotUrl?: string;
}

interface SeedWithdrawal {
  method: string;
  amountUsdMinor: number;
}

const DEPOSITS: SeedDeposit[] = [
  {
    method: "PhonePe",
    amountInrMinor: 250_073, // ₹2,500.73 — the odd paise is the reserved slot
    claimedUtr: "528312345678",
    screenshotUrl: SAMPLE_SCREENSHOT_URL,
  },
  {
    method: "UPI",
    amountInrMinor: 500_411, // ₹5,004.11
    claimedUtr: "621187654321",
  },
  {
    method: "PayTM",
    amountInrMinor: 1_075_884, // ₹10,758.84
    claimedUtr: "749900112233",
  },
];

const WITHDRAWALS: SeedWithdrawal[] = [
  { method: "upi:demo-user@paytm", amountUsdMinor: 2_500 }, // $25.00
  { method: "upi:demo-user@paytm", amountUsdMinor: 7_500 }, // $75.00
];

async function ensureDemoUser(): Promise<string> {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { emailVerified: true, status: "ACTIVE" },
    create: {
      email: EMAIL,
      firstName: "Approvals",
      lastName: "Demo",
      passwordHash: hash,
      role: "USER",
      emailVerified: true,
    },
    select: { id: true },
  });
  try {
    await createAccountsForUser(user.id, DEMO_BALANCE_INR);
  } catch {
    /* accounts already exist */
  }
  return user.id;
}

async function main(): Promise<void> {
  const userId = await ensureDemoUser();

  // Wipe previously-seeded rows so the seed stays idempotent. The tag scoping
  // keeps a real production deposit/withdrawal from getting caught here.
  await prisma.deposit.deleteMany({
    where: { userId, correlationId: { startsWith: CORRELATION_TAG } },
  });
  await prisma.withdrawal.deleteMany({
    where: { userId, reason: CORRELATION_TAG },
  });

  const now = Date.now();

  for (let i = 0; i < DEPOSITS.length; i++) {
    const d = DEPOSITS[i]!;
    // Space the createdAt so the "oldest first" ordering on the admin queue
    // is visible when you look at the list.
    const createdAt = new Date(now - (DEPOSITS.length - i) * 15 * 60_000);
    await prisma.deposit.create({
      data: {
        userId,
        method: d.method,
        amountInr: d.amountInrMinor,
        amountUsd: Math.round(d.amountInrMinor / 107.64),
        vpa: "7977304892@axl",
        checkoutToken: `${CORRELATION_TAG}-token-${i}-${now}`,
        claimedUtr: d.claimedUtr,
        status: "PENDING_CONFIRMATION",
        correlationId: `${CORRELATION_TAG}-${i}`,
        expiresAt: new Date(now + 60 * 60_000),
        screenshotUrl: d.screenshotUrl ?? null,
        createdAt,
      },
    });
  }

  for (let i = 0; i < WITHDRAWALS.length; i++) {
    const w = WITHDRAWALS[i]!;
    const createdAt = new Date(now - (WITHDRAWALS.length - i) * 25 * 60_000);
    await prisma.withdrawal.create({
      data: {
        userId,
        amount: w.amountUsdMinor,
        method: w.method,
        status: "REQUESTED",
        reason: CORRELATION_TAG,
        createdAt,
      },
    });
  }

  console.log(
    `Seeded ${DEPOSITS.length} pending deposits and ${WITHDRAWALS.length} withdrawal requests under ${EMAIL}.`,
  );
  console.log(
    `Open http://localhost:3000/admin/login and sign in, then hit /admin/approvals.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
