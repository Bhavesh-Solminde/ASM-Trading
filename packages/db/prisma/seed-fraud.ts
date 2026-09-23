/**
 * Dev-only seed for anti-fraud testing. Do NOT run this in production.
 *
 * Creates five users with a shared, well-known password:
 *   hazA / hazB / hazC — same signup IP + same UA, signed up minutes apart.
 *   hazA and hazB share a UPI deposit method (extra signal). All three should
 *   raise a LINKED_ACCOUNT flag when the detector runs on any of them.
 *
 *   clean1 / clean2 — unrelated networks, unique UAs, unique methods. Never
 *   linked to anyone. Used as the control group.
 *
 * A completed deposit is created on hazA + hazB + clean1 to trigger the
 * detector's usual entry point (deposit approval), so the FraudFlag rows
 * for the hazzing group are already present after this script runs and the
 * admin queue is populated for hand-testing.
 *
 * Idempotent: rerunning the script updates rather than duplicating.
 */

import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../src/client";
import { createAccountsForUser } from "../src/repositories/account";
import { creditDepositToAccount, createDepositIntent, claimUtr } from "../src/repositories/deposit";
import { flagLinkageForUser } from "../src/repositories/fraud";
import { writeSignupCapture } from "../src/repositories/user";

const PASSWORD = "asm-fraud-test-2026";
const DOMAIN = "@fraud.asmtrade.local";
const SHARED_IP = "203.0.113.42";
const SHARED_UA = "Mozilla/5.0 (Windows NT 10; Win64; x64) attacker-suite";

async function ensureUser(email: string, hash: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    update: { emailVerified: true, liveAccess: true },
    create: {
      email,
      passwordHash: hash,
      role: "USER",
      emailVerified: true,
      liveAccess: true,
    },
    select: { id: true },
  });
  // Ensure accounts exist. createAccountsForUser is a no-op if they do.
  try {
    await createAccountsForUser(user.id, 10_000_000);
  } catch {
    /* accounts already exist */
  }
  return user.id;
}

async function seedCompletedDeposit(userId: string, method: string, amountInr: number): Promise<void> {
  const existing = await prisma.deposit.findFirst({
    where: { userId, status: "COMPLETED", method },
  });
  if (existing) return;

  const dep = await createDepositIntent({
    userId,
    method,
    amountInrMinor: amountInr,
    correlationId: randomUUID(),
    ipAddress: SHARED_IP,
    userAgent: SHARED_UA,
  });
  await claimUtr(userId, dep.id, `SEED${Date.now().toString().slice(-8)}`);
  await creditDepositToAccount({
    depositId: dep.id,
    adminId: "seed-fraud",
    creditId: null,
  });
}

async function main(): Promise<void> {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // Linked trio.
  const hazA = await ensureUser(`hazA${DOMAIN}`, hash);
  const hazB = await ensureUser(`hazB${DOMAIN}`, hash);
  const hazC = await ensureUser(`hazC${DOMAIN}`, hash);
  await writeSignupCapture({ userId: hazA, ip: SHARED_IP, userAgent: SHARED_UA });
  await writeSignupCapture({ userId: hazB, ip: SHARED_IP, userAgent: SHARED_UA });
  await writeSignupCapture({ userId: hazC, ip: SHARED_IP, userAgent: SHARED_UA });

  // Clean pair — different IP, different UA per user, no method overlap.
  const clean1 = await ensureUser(`clean1${DOMAIN}`, hash);
  const clean2 = await ensureUser(`clean2${DOMAIN}`, hash);
  await writeSignupCapture({
    userId: clean1,
    ip: "198.51.100.9",
    userAgent: "Mozilla/5.0 (iPhone) clean1",
  });
  await writeSignupCapture({
    userId: clean2,
    ip: "192.0.2.55",
    userAgent: "Mozilla/5.0 (Android) clean2",
  });

  // hazA and hazB share the same UPI method — the "hardest to hide" signal.
  await seedCompletedDeposit(hazA, "upi:hazzer@icici", 5_000_000);
  await seedCompletedDeposit(hazB, "upi:hazzer@icici", 5_000_000);
  // hazC deposits from a different method to prove the IP alone is enough.
  await seedCompletedDeposit(hazC, "upi:hazzer-alt@axis", 5_000_000);
  // Clean users deposit too, so the admin queue clearly separates them.
  await seedCompletedDeposit(clean1, "upi:clean1@sbi", 5_000_000);

  // Explicitly re-run the detector so a fresh run produces flags even if the
  // in-repo deposit-approval hook has evolved.
  for (const uid of [hazA, hazB, hazC]) {
    await flagLinkageForUser({ userId: uid });
  }

  const flags = await prisma.fraudFlag.count({
    where: { userId: { in: [hazA, hazB, hazC] } },
  });

  console.log(`
  Fraud seed complete.

  Password (shared, DEV ONLY):     ${PASSWORD}
  Linked group (should be flagged): hazA${DOMAIN}, hazB${DOMAIN}, hazC${DOMAIN}
    - Shared signupIp:              ${SHARED_IP}
    - Shared signupUserAgent:       ${SHARED_UA}
    - Shared deposit method:        upi:hazzer@icici (hazA + hazB)
  Control group (should be CLEAN): clean1${DOMAIN}, clean2${DOMAIN}
  Open FraudFlag rows for the trio: ${flags}
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
