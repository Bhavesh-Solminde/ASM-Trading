import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

// Owner role: the runtime role may not delete append-only program rows during cleanup.
vi.hoisted(() => {
  if (process.env.DATABASE_MIGRATE_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATE_URL;
});

class Redirect extends Error {}
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "t" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "c", readAdminSession: async () => true }));

import { prisma } from "@asm/db";
import * as A from "./actions";

const RUN = randomUUID();
let n = 0;

afterAll(async () => {
  await prisma.programSetting.deleteMany({ where: { reason: { contains: RUN } } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function run(action: (f: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  try {
    await action(f);
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.message);
    throw e;
  }
  throw new Error("no redirect");
}

const makeUser = (data: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { email: `adm-prog-${n++}-${RUN}@test.local`, passwordHash: "x", kycStatus: "VERIFIED", ...data } });

describe("affiliate-program admin actions (real DB)", () => {
  it("settings: schedules a future version in stored units", async () => {
    const url = await run(A.scheduleSettingAction, {
      key: "PROGRAM_WITHDRAWALS_PER_MONTH",
      value: "7",
      effectiveFrom: "2099-01-01T00:00",
      reason: `test ${RUN}`,
    });
    expect(url).toContain("ok=");
    const row = await prisma.programSetting.findFirstOrThrow({ where: { reason: `test ${RUN}` } });
    expect(row).toMatchObject({ key: "PROGRAM_WITHDRAWALS_PER_MONTH", value: 7, createdBy: "admin-panel" });
    expect(row.effectiveFrom.toISOString()).toBe("2098-12-31T18:30:00.000Z");
  });

  it("affiliates: approves, then assigns a rate", async () => {
    const aff = await makeUser({ role: "AFFILIATE", emailVerified: true, affiliateProfile: { create: { status: "PENDING_APPROVAL" } } });
    expect(await run(A.setAffiliateStatusAction, { userId: aff.id, status: "ACTIVE", reason: "looks good" })).toContain("ok=");
    expect((await prisma.affiliateProfile.findUniqueOrThrow({ where: { userId: aff.id } })).status).toBe("ACTIVE");

    expect(await run(A.assignAffiliateRateAction, { affiliateId: aff.id, revenueSharePct: "30", depositRewardPct: "6.5", reason: "deal" })).toContain("ok=");
    const rate = await prisma.affiliateRate.findFirstOrThrow({ where: { affiliateId: aff.id } });
    expect(rate).toMatchObject({ revenueShareBps: 3_000, depositRewardBps: 650, createdBy: "admin-panel" });

    // A second approve is refused by the db and shown on the page.
    expect(await run(A.setAffiliateStatusAction, { userId: aff.id, status: "ACTIVE", reason: "again" })).toContain("error=");
  });

  it("withdrawals: approve then mark paid are separate steps; reject returns funds", async () => {
    const u = await makeUser();
    await prisma.programWallet.create({ data: { userId: u.id, availableMinor: 0, reservedMinor: 400_000 } });
    const mk = () =>
      prisma.programWithdrawal.create({
        data: { userId: u.id, amountMinor: 200_000, method: "UPI", upiId: "x@okaxis", idempotencyKey: randomUUID() },
      });
    const w1 = await mk();
    const w2 = await mk();

    expect(await run(A.markProgramWithdrawalPaidAction, { withdrawalId: w1.id, paymentReference: "UTR1" })).toContain("error=");
    await run(A.approveProgramWithdrawalAction, { withdrawalId: w1.id });
    expect((await prisma.programWithdrawal.findUniqueOrThrow({ where: { id: w1.id } })).status).toBe("APPROVED");
    await run(A.markProgramWithdrawalPaidAction, { withdrawalId: w1.id, paymentReference: "UTR1" });
    expect(await prisma.programWithdrawal.findUniqueOrThrow({ where: { id: w1.id } })).toMatchObject({ status: "PAID", paymentReference: "UTR1" });

    await run(A.rejectProgramWithdrawalAction, { withdrawalId: w2.id, reason: "name mismatch" });
    expect(await prisma.programWithdrawal.findUniqueOrThrow({ where: { id: w2.id } })).toMatchObject({ status: "REJECTED", reason: "name mismatch" });
    expect(await prisma.programWallet.findUniqueOrThrow({ where: { userId: u.id } })).toMatchObject({
      availableMinor: 200_000,
      reservedMinor: 0,
      paidMinor: 200_000,
    });
  });

  it("earnings review: releases a held earning and records an adjustment by email", async () => {
    const u = await makeUser();
    const e = await prisma.programEarning.create({
      data: { beneficiaryUserId: u.id, kind: "REFERRAL_REWARD", amountMinor: 5_000, status: "HELD", holdReason: "test", earnedAt: new Date() },
    });
    await run(A.releaseHeldEarningAction, { earningId: e.id, note: "verified" });
    expect((await prisma.programEarning.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("PENDING");

    expect(await run(A.createProgramAdjustmentAction, { user: u.email.toUpperCase(), amount: "100.50", reason: "goodwill", idempotencyKey: randomUUID() })).toContain("ok=");
    expect((await prisma.programWallet.findUniqueOrThrow({ where: { userId: u.id } })).availableMinor).toBe(10_050);
    expect(await run(A.createProgramAdjustmentAction, { user: u.id, amount: "-200", reason: "too much", idempotencyKey: randomUUID() })).toContain("Not enough available");
  });
});
