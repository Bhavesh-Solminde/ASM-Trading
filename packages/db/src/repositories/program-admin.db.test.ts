import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { ensureAffiliateProfile, onAffiliateEmailVerified } from "./affiliate-profile";
import { creditDepositToAccount } from "./deposit";
import { consumeEmailVerificationToken, issueEmailVerificationToken } from "./email-verification";
import {
  appendAffiliateRate,
  appendProgramSetting,
  clearNeedsReview,
  getAffiliateAdminDetail,
  listAffiliatesForAdmin,
  listEarningsForReview,
  listProgramSettingHistory,
  releaseHeldEarning,
  setAffiliateStatus,
  voidHeldEarning,
} from "./program-admin";
import { ProgramActionRefused } from "./program-errors";
import { evaluateReferralQualification } from "./referral-qualification";

// Affiliate program Phases 5–7: affiliate status and admin data layer.
const RUN = randomUUID();
const ACTOR = `test-${RUN}`;
const FUTURE = new Date("2900-01-01T00:00:00Z"); // settings tests never touch values in force today
let n = 0;
let assetId = "";

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ select: { id: true } })).id;
});

afterAll(async () => {
  // Profiles, rates, earnings, qualifications cascade with their user. AuditLog rows stay (append-only).
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.programSetting.deleteMany({ where: { createdBy: ACTOR } });
  await prisma.$disconnect();
});

async function makeUser(data: Partial<Prisma.UserCreateInput> = {}) {
  const u = await prisma.user.create({ data: { email: `pa-${n++}-${RUN}@test.local`, passwordHash: "x", ...data } });
  await createAccountsForUser(u.id, 0, "INR");
  return u;
}

async function makeAffiliate(status?: "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL", emailVerified = status !== undefined) {
  const u = await makeUser({ role: "AFFILIATE", emailVerified });
  await ensureAffiliateProfile(u.id);
  if (status) await prisma.affiliateProfile.update({ where: { userId: u.id }, data: { status } });
  return u;
}

/** A referred friend with a credited deposit of `inr` paise and a settled ₹100 trade, evaluated. */
async function qualifyFriendOf(inviterId: string, inr: number) {
  const friend = await makeUser({ referredBy: { connect: { id: inviterId } }, referredAt: new Date(), referralVia: "LINK" });
  const d = await prisma.deposit.create({
    data: {
      userId: friend.id,
      method: "upi",
      amountInr: inr,
      amountUsd: Math.round(inr / 100),
      vpa: "test@upi",
      checkoutToken: randomUUID(),
      correlationId: RUN,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await creditDepositToAccount({ depositId: d.id, adminId: null });
  const account = await prisma.account.findFirstOrThrow({ where: { userId: friend.id, type: "LIVE" } });
  const at = new Date();
  await prisma.trade.create({
    data: {
      accountId: account.id,
      assetId,
      mode: "LEGACY_BINARY",
      direction: "UP",
      stake: 10_000,
      payoutPct: 80,
      entryPrice: 1,
      entryTs: new Date(at.getTime() - 60_000),
      expiryTs: at,
      status: "LOST",
    },
  });
  await evaluateReferralQualification(friend.id);
  return friend;
}

const earningOf = (beneficiaryUserId: string) => prisma.programEarning.findFirstOrThrow({ where: { beneficiaryUserId } });
const statusOf = async (userId: string) => (await prisma.affiliateProfile.findUniqueOrThrow({ where: { userId } })).status;
const audits = (targetId: string, action: string) => prisma.auditLog.findMany({ where: { targetId, action } });
const refused = (code: string) => expect.objectContaining({ name: "ProgramActionRefused", code });

describe("affiliate profile lifecycle", () => {
  it("signup → PENDING_VERIFICATION → email verified → ACTIVE, audited", async () => {
    const aff = await makeAffiliate();
    expect(await statusOf(aff.id)).toBe("PENDING_VERIFICATION");
    const { token } = await issueEmailVerificationToken(aff.id);
    expect(await consumeEmailVerificationToken(token)).toEqual({ userId: aff.id });
    expect(await statusOf(aff.id)).toBe("ACTIVE");
    expect(await audits(aff.id, "affiliate.status_changed")).toHaveLength(1);
  });

  it("with approval required → PENDING_APPROVAL → approve → ACTIVE; suspend and reinstate", async () => {
    await appendProgramSetting({ key: "AFFILIATE_REQUIRES_APPROVAL", value: 1, effectiveFrom: FUTURE, reason: `test ${RUN}`, actor: ACTOR });
    const aff = await makeAffiliate();
    await prisma.user.update({ where: { id: aff.id }, data: { emailVerified: true } });
    const later = new Date("2901-01-01T00:00:00Z");
    expect((await onAffiliateEmailVerified(aff.id, prisma, later))?.status).toBe("PENDING_APPROVAL");

    await expect(setAffiliateStatus({ userId: aff.id, status: "ACTIVE", reason: "  ", actor: ACTOR })).rejects.toEqual(refused("invalid_input"));
    expect((await setAffiliateStatus({ userId: aff.id, status: "ACTIVE", reason: "KYC looks fine", actor: ACTOR })).status).toBe("ACTIVE");
    // Verification again never downgrades an ACTIVE or SUSPENDED profile.
    expect((await onAffiliateEmailVerified(aff.id, prisma, later))?.status).toBe("ACTIVE");
    await setAffiliateStatus({ userId: aff.id, status: "SUSPENDED", reason: "abuse report", actor: ACTOR });
    expect((await onAffiliateEmailVerified(aff.id, prisma, later))?.status).toBe("SUSPENDED");
    await setAffiliateStatus({ userId: aff.id, status: "ACTIVE", reason: "cleared", actor: ACTOR });
    expect(await statusOf(aff.id)).toBe("ACTIVE");

    const rows = await audits(aff.id, "affiliate.status_changed");
    expect(rows.filter((r) => r.actorId === ACTOR)).toHaveLength(3);
    expect(rows.find((r) => r.actorId === ACTOR)?.after).toMatchObject({ reason: expect.any(String) });
  });

  it("refuses senseless transitions and reinstating an unverified affiliate", async () => {
    const pending = await makeAffiliate();
    await expect(setAffiliateStatus({ userId: pending.id, status: "ACTIVE", reason: "x", actor: ACTOR })).rejects.toEqual(refused("invalid_state"));
    await setAffiliateStatus({ userId: pending.id, status: "SUSPENDED", reason: "spam", actor: ACTOR });
    await expect(setAffiliateStatus({ userId: pending.id, status: "ACTIVE", reason: "x", actor: ACTOR })).rejects.toEqual(refused("invalid_state"));
    await expect(setAffiliateStatus({ userId: pending.id, status: "PENDING_APPROVAL", reason: "x", actor: ACTOR })).rejects.toEqual(refused("invalid_state"));
    await expect(setAffiliateStatus({ userId: randomUUID(), status: "SUSPENDED", reason: "x", actor: ACTOR })).rejects.toEqual(refused("not_found"));
  });

  it("only non-legacy affiliates get a profile; regular users are a no-op on verification", async () => {
    const user = await makeUser();
    await expect(ensureAffiliateProfile(user.id)).rejects.toBeInstanceOf(ProgramActionRefused);
    expect(await onAffiliateEmailVerified(user.id)).toBeNull();
    const legacy = await makeUser({ role: "AFFILIATE", legacySimulated: true, status: "BANNED" });
    await expect(ensureAffiliateProfile(legacy.id)).rejects.toBeInstanceOf(ProgramActionRefused);
  });
});

describe("qualification with affiliate status and per-affiliate rates", () => {
  it("holds the reward when the affiliate is not ACTIVE", async () => {
    const aff = await makeAffiliate("SUSPENDED");
    await qualifyFriendOf(aff.id, 100_000);
    expect(await earningOf(aff.id)).toMatchObject({ status: "HELD", holdReason: "affiliate not active", amountMinor: 5_000 });
  });

  it("uses the per-affiliate deposit reward (7%: ₹1,000 → ₹70) and falls back to the global 5%", async () => {
    const aff = await makeAffiliate("ACTIVE");
    await appendAffiliateRate({ affiliateId: aff.id, revenueShareBps: 2_500, depositRewardBps: 700, effectiveFrom: new Date(), reason: `test ${RUN}`, actor: ACTOR });
    await qualifyFriendOf(aff.id, 100_000);
    expect(await earningOf(aff.id)).toMatchObject({ status: "PENDING", amountMinor: 7_000 });

    const plain = await makeAffiliate("ACTIVE");
    await appendAffiliateRate({ affiliateId: plain.id, revenueShareBps: 1_000, depositRewardBps: null, effectiveFrom: new Date(), reason: `test ${RUN}`, actor: ACTOR });
    await qualifyFriendOf(plain.id, 100_000);
    expect(await earningOf(plain.id)).toMatchObject({ status: "PENDING", amountMinor: 5_000 });
  });
});

describe("rate and setting validation", () => {
  it("validates rates, the affiliate and refuses back-dating; audits the write", async () => {
    const aff = await makeAffiliate("ACTIVE");
    const base = { affiliateId: aff.id, revenueShareBps: 100, depositRewardBps: null, effectiveFrom: new Date(), reason: "ok", actor: ACTOR };
    await expect(appendAffiliateRate({ ...base, revenueShareBps: 10_001 })).rejects.toEqual(refused("invalid_input"));
    await expect(appendAffiliateRate({ ...base, depositRewardBps: -1 })).rejects.toEqual(refused("invalid_input"));
    await expect(appendAffiliateRate({ ...base, revenueShareBps: 1.5 })).rejects.toEqual(refused("invalid_input"));
    await expect(appendAffiliateRate({ ...base, effectiveFrom: new Date(Date.now() - 120_000) })).rejects.toEqual(refused("invalid_input"));
    await expect(appendAffiliateRate({ ...base, reason: "x".repeat(501) })).rejects.toEqual(refused("invalid_input"));
    await expect(appendAffiliateRate({ ...base, affiliateId: (await makeUser()).id })).rejects.toEqual(refused("not_found"));
    const row = await appendAffiliateRate({ ...base, effectiveFrom: new Date(Date.now() - 30_000) }); // inside the 60 s tolerance
    expect(await audits(row.id, "affiliate.rate_assigned")).toHaveLength(1);
    expect((await getAffiliateAdminDetail(aff.id))?.currentRate).toMatchObject({ rateId: row.id, revenueShareBps: 100 });
  });

  it("validates settings per key and refuses back-dating", async () => {
    const base = { effectiveFrom: FUTURE, reason: `test ${RUN}`, actor: ACTOR };
    const bad: [Parameters<typeof appendProgramSetting>[0]["key"], number][] = [
      ["AFFILIATE_DEPOSIT_REWARD_BPS", 10_001],
      ["INVITE_EXTRA_BONUS_PCT", 101],
      ["AFFILIATE_REQUIRES_APPROVAL", 2],
      ["MIN_QUALIFYING_DEPOSIT_INR_MINOR", 0],
      ["MIN_QUALIFYING_TRADE_INR_MINOR", -1],
      ["PROGRAM_WITHDRAWALS_PER_DAY", 1.5],
      ["USER_REFERRAL_REWARD_INR_MINOR", 50_001], // above the ₹500 minimum deposit
    ];
    for (const [key, value] of bad) {
      await expect(appendProgramSetting({ ...base, key, value })).rejects.toEqual(refused("invalid_input"));
    }
    await expect(appendProgramSetting({ ...base, key: "INVITE_EXTRA_BONUS_PCT", value: 10, effectiveFrom: new Date(Date.now() - 120_000) })).rejects.toEqual(
      refused("invalid_input"),
    );
    await expect(appendProgramSetting({ ...base, key: "INVITE_EXTRA_BONUS_PCT", value: 10, reason: "" })).rejects.toEqual(refused("invalid_input"));

    const row = await appendProgramSetting({ ...base, key: "INVITE_EXTRA_BONUS_PCT", value: 12, effectiveFrom: new Date("2950-01-01T00:00:00Z") });
    expect(row).toMatchObject({ key: "INVITE_EXTRA_BONUS_PCT", value: 12, createdBy: ACTOR });
    const audit = await audits(row.id, "program.setting_changed");
    expect(audit[0]).toMatchObject({ actorId: ACTOR, before: { key: "INVITE_EXTRA_BONUS_PCT" }, after: { value: 12 } });

    const history = await listProgramSettingHistory();
    const mine = history.find((h) => h.id === row.id)!;
    expect(mine.inForce).toBe(false); // future
    expect(history.filter((h) => h.key === "INVITE_EXTRA_BONUS_PCT" && h.inForce)).toHaveLength(1);
  });
});

describe("earnings review", () => {
  it("releases a HELD earning to PENDING and voids another, audited; both refuse a second time", async () => {
    const aff = await makeAffiliate("SUSPENDED");
    await qualifyFriendOf(aff.id, 50_000);
    await qualifyFriendOf(aff.id, 50_000);
    const [a, b] = await prisma.programEarning.findMany({ where: { beneficiaryUserId: aff.id }, orderBy: { createdAt: "asc" } });

    const held = await listEarningsForReview({ filter: "HELD" });
    expect(held.pageSize).toBe(50);
    expect(held.total).toBeGreaterThanOrEqual(2);

    await expect(releaseHeldEarning({ earningId: a!.id, actor: ACTOR, note: "" })).rejects.toEqual(refused("invalid_input"));
    expect(await releaseHeldEarning({ earningId: a!.id, actor: ACTOR, note: "checked, genuine" })).toMatchObject({ status: "PENDING", holdReason: null });
    await expect(releaseHeldEarning({ earningId: a!.id, actor: ACTOR, note: "again" })).rejects.toEqual(refused("invalid_state"));
    expect(await voidHeldEarning({ earningId: b!.id, actor: ACTOR, reason: "fake friend" })).toMatchObject({ status: "VOID", voidReason: "fake friend" });
    await expect(voidHeldEarning({ earningId: b!.id, actor: ACTOR, reason: "again" })).rejects.toEqual(refused("invalid_state"));
    await expect(voidHeldEarning({ earningId: randomUUID(), actor: ACTOR, reason: "x" })).rejects.toEqual(refused("not_found"));

    const [rel] = await audits(a!.id, "program.earning_released");
    expect(rel).toMatchObject({ actorId: ACTOR, before: { status: "HELD", holdReason: "affiliate not active" }, after: { status: "PENDING", reason: "checked, genuine" } });
    expect(await audits(b!.id, "program.earning_voided")).toHaveLength(1);
  });

  it("clears needsReview with a note, audited", async () => {
    const aff = await makeAffiliate("ACTIVE");
    await qualifyFriendOf(aff.id, 50_000);
    const e = await earningOf(aff.id);
    await expect(clearNeedsReview({ earningId: e.id, actor: ACTOR, note: "n/a" })).rejects.toEqual(refused("invalid_state"));
    await prisma.programEarning.update({ where: { id: e.id }, data: { needsReview: true } });
    expect((await listEarningsForReview({ filter: "NEEDS_REVIEW" })).rows.some((r) => r.id === e.id && r.beneficiary.email.includes(RUN))).toBe(true);
    expect(await clearNeedsReview({ earningId: e.id, actor: ACTOR, note: "deposit re-sent" })).toMatchObject({ needsReview: false, status: "PENDING" });
    expect(await audits(e.id, "program.earning_review_cleared")).toHaveLength(1);
  });
});

describe("admin affiliate aggregates", () => {
  it("lists and details an affiliate with referral, deposit, earning, rate and flag aggregates", async () => {
    const aff = await makeAffiliate("ACTIVE");
    await prisma.user.update({ where: { id: aff.id }, data: { firstName: `Zed${RUN.slice(0, 8)}` } });
    const f1 = await qualifyFriendOf(aff.id, 100_000);
    await qualifyFriendOf(aff.id, 60_000);
    await makeUser({ referredBy: { connect: { id: aff.id } }, referredAt: new Date(), referralVia: "CODE" }); // not qualified
    await prisma.fraudFlag.create({ data: { userId: f1.id, kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: [f1.id, aff.id], evidence: {} } });
    await prisma.programWallet.create({ data: { userId: aff.id, availableMinor: 1_234 } });

    const list = await listAffiliatesForAdmin({ q: aff.email.toUpperCase(), status: "ACTIVE" });
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({
      userId: aff.id,
      status: "ACTIVE",
      emailVerified: true,
      kycStatus: "NOT_STARTED",
      totalReferrals: 3,
      qualifiedReferrals: 2,
      totalDepositedMinor: 160_000,
      earnings: { PENDING: 8_000, HELD: 0, VOID: 0, AVAILABLE: 0 },
      wallet: { availableMinor: 1_234, reservedMinor: 0, transferredMinor: 0, paidMinor: 0 },
      currentRate: null,
      openSelfReferralFlags: 1,
    });
    expect((await listAffiliatesForAdmin({ q: `zed${RUN.slice(0, 8)}` })).rows.map((r) => r.userId)).toEqual([aff.id]);
    expect((await listAffiliatesForAdmin({ q: aff.email, status: "SUSPENDED" })).total).toBe(0);

    const detail = await getAffiliateAdminDetail(aff.id);
    expect(detail).toMatchObject({ userId: aff.id, qualifiedReferrals: 2, rates: [] });
    expect(detail!.flags).toHaveLength(1);
    expect(await getAffiliateAdminDetail(randomUUID())).toBeNull();
  });
});
