import { prisma, type DbClient, type DbTransaction } from "../client";
import type { AffiliateProfile, AffiliateStatus, ProgramSettingKey } from "../../generated/prisma/client";
import { ProgramActionRefused } from "./program-errors";

// Affiliate status (Affiliate Program spec "Affiliate status").

type Db = DbClient | DbTransaction;

/** The value of one program setting in force at `at` (latest effectiveFrom <= at; ties → newest row). */
export async function programSettingValueAt(key: ProgramSettingKey, at: Date, client: Db = prisma): Promise<number | null> {
  const row = await client.programSetting.findFirst({
    where: { key, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { value: true },
  });
  return row ? row.value : null;
}

/** Status an affiliate whose email is verified gets: ACTIVE, or PENDING_APPROVAL while AFFILIATE_REQUIRES_APPROVAL is 1. */
async function verifiedStatus(at: Date, client: Db): Promise<AffiliateStatus> {
  return (await programSettingValueAt("AFFILIATE_REQUIRES_APPROVAL", at, client)) === 1 ? "PENDING_APPROVAL" : "ACTIVE";
}

/**
 * The affiliate's profile, created if missing (PENDING_VERIFICATION, or the
 * verified status when the email is already verified). Throws for anyone who
 * is not a non-legacy affiliate. Pass the signup transaction as `client`.
 */
export async function ensureAffiliateProfile(userId: string, client: Db = prisma): Promise<AffiliateProfile> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { role: true, legacySimulated: true, emailVerified: true, affiliateProfile: true },
  });
  if (!user || user.role !== "AFFILIATE" || user.legacySimulated) {
    throw new ProgramActionRefused("not_found", "Not an affiliate account.");
  }
  if (user.affiliateProfile) return user.affiliateProfile;
  const status = user.emailVerified ? await verifiedStatus(new Date(), client) : "PENDING_VERIFICATION";
  // upsert: a concurrent ensure for the same user must not fail on the primary key.
  return client.affiliateProfile.upsert({ where: { userId }, create: { userId, status }, update: {} });
}

/**
 * Email verified: PENDING_VERIFICATION → ACTIVE, or PENDING_APPROVAL when the
 * approval setting is 1 at `at`. Never moves any other status (an ACTIVE or
 * SUSPENDED affiliate stays as is). Null for a non-affiliate (regular users
 * have no profile). Call inside the verification transaction.
 */
export async function onAffiliateEmailVerified(
  userId: string,
  client: Db = prisma,
  at: Date = new Date(),
): Promise<AffiliateProfile | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { role: true, legacySimulated: true } });
  if (!user || user.role !== "AFFILIATE" || user.legacySimulated) return null;
  const profile = await ensureAffiliateProfile(userId, client);
  if (profile.status !== "PENDING_VERIFICATION") return profile;
  const status = await verifiedStatus(at, client);
  const moved = await client.affiliateProfile.updateMany({
    where: { userId, status: "PENDING_VERIFICATION" },
    data: { status, statusReason: "email verified", statusChangedAt: at, statusChangedBy: "system" },
  });
  if (moved.count === 1) {
    await client.auditLog.create({
      data: {
        actorId: null,
        action: "affiliate.status_changed",
        targetType: "AffiliateProfile",
        targetId: userId,
        before: { status: "PENDING_VERIFICATION" },
        after: { status, reason: "email verified" },
      },
    });
  }
  return client.affiliateProfile.findUniqueOrThrow({ where: { userId } });
}
