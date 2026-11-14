import { randomInt } from "node:crypto";
import { prisma } from "../client";
import type { ReferralVia, Role } from "../../generated/prisma/client";

// No 0/O/1/I so a code read aloud or copied by hand survives.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_SHAPE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_ATTEMPTS = 8;
// Attachment is part of the signup request; an older row is an existing user and can't be claimed.
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
// requestContext() placeholders when a header is missing; they'd "match" every local signup.
const PLACEHOLDER_IP = "local";
const PLACEHOLDER_UA = "unknown";

export function normaliseReferralCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  return CODE_SHAPE.test(code) ? code : null;
}

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export async function ensureReferralCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (user.referralCode) return user.referralCode;
    try {
      // Conditional so two concurrent first calls can't hand out different codes.
      await prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: generateCode() } });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err; // collision: try another code
    }
  }
  throw new Error("could not assign a unique referral code");
}

export async function resolveInvitationCode(code: string): Promise<{ inviterId: string } | null> {
  const normalised = normaliseReferralCode(code);
  if (!normalised) return null;
  const inviter = await prisma.user.findFirst({
    where: {
      referralCode: normalised,
      role: { in: ["USER", "AFFILIATE"] },
      legacySimulated: false,
      status: { in: ["ACTIVE", "FLAGGED"] },
    },
    select: { id: true },
  });
  return inviter ? { inviterId: inviter.id } : null;
}

export type ReferralOutcome = "attached" | "invalid" | "self" | "already";

/**
 * Records the inviter of a just-created user. Written once: the update is
 * conditional on `referredById IS NULL` (and a fresh row), so retries and
 * races never replace an inviter. Shared signals open a SELF_REFERRAL flag
 * for review but keep the referral and never block the signup.
 */
export async function attachReferralAtSignup(input: {
  userId: string;
  code: string;
  via: ReferralVia;
  ip: string;
  userAgent: string;
  deviceFp?: string | null;
}): Promise<{ outcome: ReferralOutcome; flagged: boolean }> {
  const resolved = await resolveInvitationCode(input.code);
  if (!resolved) return { outcome: "invalid", flagged: false };
  if (resolved.inviterId === input.userId) return { outcome: "self", flagged: false };

  const [invitee, inviter] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }),
    prisma.user.findUniqueOrThrow({
      where: { id: resolved.inviterId },
      select: { email: true, signupIp: true, lastIp: true, signupUserAgent: true, lastUserAgent: true, signupDeviceFp: true },
    }),
  ]);
  if (!invitee) return { outcome: "invalid", flagged: false };
  if (invitee.email.toLowerCase() === inviter.email.toLowerCase()) return { outcome: "self", flagged: false };

  const ip = input.ip && input.ip !== PLACEHOLDER_IP ? input.ip : null;
  const ua = input.userAgent && input.userAgent !== PLACEHOLDER_UA ? input.userAgent : null;
  const sharedIps = ip && (ip === inviter.signupIp || ip === inviter.lastIp) ? [ip] : [];
  const sharedUserAgents = ua && (ua === inviter.signupUserAgent || ua === inviter.lastUserAgent) ? [ua] : [];
  const sharedDeviceFps = input.deviceFp && input.deviceFp === inviter.signupDeviceFp ? [input.deviceFp] : [];
  // Same UA + IP is a subset of the IP signal; it is recorded as evidence, not a separate trigger.
  const flagged = sharedIps.length > 0 || sharedDeviceFps.length > 0;

  const attached = await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: input.userId, referredById: null, createdAt: { gte: new Date(Date.now() - SIGNUP_WINDOW_MS) } },
      data: { referredById: resolved.inviterId, referredAt: new Date(), referralVia: input.via },
    });
    if (count === 0) return false;
    if (flagged) {
      await tx.fraudFlag.create({
        data: {
          userId: input.userId,
          kind: "SELF_REFERRAL",
          status: "OPEN",
          linkedUserIds: [input.userId, resolved.inviterId],
          evidence: { inviterId: resolved.inviterId, via: input.via, sharedIps, sharedUserAgents, sharedDeviceFps },
        },
      });
    }
    return true;
  });
  return attached ? { outcome: "attached", flagged } : { outcome: "already", flagged: false };
}

export interface ReferralSummary {
  referredBy: { id: string; email: string; role: Role } | null;
  referredAt: Date | null;
  via: ReferralVia | null;
  code: string | null;
  /** OPEN SELF_REFERRAL flags naming this account as invitee or inviter. */
  selfReferralFlags: number;
}

export async function getReferralSummaryForAdmin(userId: string): Promise<ReferralSummary | null> {
  const [user, selfReferralFlags] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        referralCode: true,
        referredAt: true,
        referralVia: true,
        referredBy: { select: { id: true, email: true, role: true } },
      },
    }),
    prisma.fraudFlag.count({ where: { kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: { has: userId } } }),
  ]);
  if (!user) return null;
  return {
    referredBy: user.referredBy,
    referredAt: user.referredAt,
    via: user.referralVia,
    code: user.referralCode,
    selfReferralFlags,
  };
}
