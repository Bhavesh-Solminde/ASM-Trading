import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { createAccountsForUser } from "./account";
import { creditDepositToAccount, createDepositIntent } from "./deposit";
import {
  flagLinkageForUser,
  loadUserFacts,
  reviewFraudFlag,
} from "./fraud";
import { writeSignupCapture } from "./user";

/**
 * DB-integrated tests for the linked-accounts detector. Sets up 3 users:
 *   - hazA + hazB: same signupIp + same signupUserAgent, 60s apart
 *   - clean:      a lone account, different network
 *
 * The detector should flag hazA + hazB as LINKED, leave clean alone, and be
 * idempotent (re-running does not create duplicate flags).
 *
 * Requires the 20260923020000_fraud_detection migration to have been applied
 * to the database this test runs against — the User columns are otherwise
 * absent and the seed fails.
 */

let hazA = "";
let hazB = "";
let clean = "";

// Per-run randomised IPs so the test is immune to leftover rows from an
// earlier failed run (afterAll never ran) or a parallel test file that
// happens to use the same static IP. TEST-NET-3 / TEST-NET-2 keep the
// value visibly "test-only" to a human reading the DB.
function randomIp(prefix: string): string {
  return `${prefix}.${Math.floor(Math.random() * 254) + 1}`;
}
const SHARED_IP = randomIp("203.0.113");
const SHARED_UA = `Mozilla/5.0 attacker-suite ${Math.random().toString(36).slice(2, 10)}`;
const CLEAN_IP = randomIp("198.51.100");

async function makeUser(email: string, ip: string, ua: string): Promise<string> {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x" },
    select: { id: true },
  });
  await createAccountsForUser(user.id, 0);
  await writeSignupCapture({ userId: user.id, ip, userAgent: ua });
  return user.id;
}

beforeAll(async () => {
  hazA = await makeUser(`haz-a-${Date.now()}@fraud.local`, SHARED_IP, SHARED_UA);
  // Push createdAt slightly to guarantee <24h gap but distinct
  await new Promise((r) => setTimeout(r, 20));
  hazB = await makeUser(`haz-b-${Date.now()}@fraud.local`, SHARED_IP, SHARED_UA);
  clean = await makeUser(
    `clean-${Date.now()}@fraud.local`,
    CLEAN_IP,
    `Mozilla/5.0 unrelated ${Math.random().toString(36).slice(2, 10)}`,
  );
});

afterAll(async () => {
  const ids = [hazA, hazB, clean].filter((v) => v);
  await prisma.fraudFlag.deleteMany({ where: { userId: { in: ids } } });
  await prisma.transaction.deleteMany({
    where: { account: { userId: { in: ids } } },
  });
  await prisma.bonusGrant.deleteMany({
    where: { account: { userId: { in: ids } } },
  });
  await prisma.deposit.deleteMany({ where: { userId: { in: ids } } });
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("flagLinkageForUser (DB-integrated)", () => {
  it("flags hazA + hazB as LINKED and leaves the clean user alone", async () => {
    const resA = await flagLinkageForUser({ userId: hazA });
    expect(resA.verdict).toBe("LINKED");
    expect(resA.userIds).toEqual(expect.arrayContaining([hazA, hazB]));

    const flags = await prisma.fraudFlag.findMany({
      where: { userId: hazA, kind: "LINKED_ACCOUNT" },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.linkedUserIds).toEqual(expect.arrayContaining([hazA, hazB]));
    expect(flags[0]!.status).toBe("OPEN");

    const resClean = await flagLinkageForUser({ userId: clean });
    expect(resClean.verdict).toBe("CLEAN");
    const cleanFlags = await prisma.fraudFlag.findMany({ where: { userId: clean } });
    expect(cleanFlags).toHaveLength(0);
  });

  it("is idempotent — a second run on the same group does not duplicate the flag", async () => {
    await flagLinkageForUser({ userId: hazA });
    await flagLinkageForUser({ userId: hazA });
    const flags = await prisma.fraudFlag.findMany({
      where: { userId: hazA, kind: "LINKED_ACCOUNT", status: "OPEN" },
    });
    expect(flags).toHaveLength(1);
  });

  it("reviewFraudFlag transitions OPEN -> DISMISSED and writes an audit row", async () => {
    const flag = await prisma.fraudFlag.findFirstOrThrow({
      where: { userId: hazA, status: "OPEN" },
    });
    const before = await prisma.auditLog.count({
      where: { targetType: "FraudFlag", targetId: flag.id },
    });
    const updated = await reviewFraudFlag({
      flagId: flag.id,
      adminId: "admin-test",
      verdict: "DISMISSED",
      note: "shared household, verified out-of-band",
    });
    expect(updated.status).toBe("DISMISSED");
    expect(updated.reviewedBy).toBe("admin-test");
    const after = await prisma.auditLog.count({
      where: { targetType: "FraudFlag", targetId: flag.id },
    });
    expect(after).toBe(before + 1);
  });

  it("loadUserFacts returns null for a missing user rather than throwing", async () => {
    const facts = await loadUserFacts(randomUUID());
    expect(facts).toBeNull();
  });
});
