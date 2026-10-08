import { prisma } from "../client";
import type { User, UserStatus } from "../../generated/prisma/client";

/**
 * Users are not user-owned rows in the same sense — a person looks up only
 * themselves, and login looks up by email before any session exists. Neither
 * function ever accepts or writes `role`.
 */

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/** True when the user exists and has role=AFFILIATE. False for USER / ADMIN
 *  and for any missing-user case. Used by the trading engine to branch the
 *  verdict pipeline and skip house-ledger writes for affiliate trades. */
export async function isAffiliateUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === "AFFILIATE";
}

/**
 * Records the forensic pair (IP, UA) at signup. Called once, immediately after
 * user creation. Kept as its own update — separate from the create — so the
 * register route can tolerate a missing IP header (dev, local) without
 * refusing to sign a user up.
 */
export async function writeSignupCapture(input: {
  userId: string;
  ip: string;
  userAgent: string;
  deviceFp?: string | null;
}): Promise<void> {
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      signupIp: input.ip || null,
      signupUserAgent: input.userAgent || null,
      signupDeviceFp: input.deviceFp ?? null,
      lastIp: input.ip || null,
      lastUserAgent: input.userAgent || null,
      lastSeenAt: new Date(),
    },
  });
}

/**
 * Refreshes the "last seen" trio on every authenticated action. Called from
 * login and (cheaply) on high-value routes so an admin has a fresh trail
 * even for users who never log back in via the login route.
 */
export async function updateUserLastSeen(input: {
  userId: string;
  ip: string;
  userAgent: string;
}): Promise<void> {
  const hasIp = input.ip.length > 0;
  const hasUa = input.userAgent.length > 0;
  if (!hasIp && !hasUa) return;
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      ...(hasIp && { lastIp: input.ip }),
      ...(hasUa && { lastUserAgent: input.userAgent }),
      lastSeenAt: new Date(),
    },
  });
}

/**
 * Admin-driven status change with an audit trail. The trade desk, withdrawal
 * repo and deposit approver all check `User.status === 'ACTIVE'` before
 * moving money — this function is the ONLY writer of that column.
 */
export async function setUserStatus(input: {
  userId: string;
  status: UserStatus;
  reason: string;
  adminId: string | null;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { status: true, statusReason: true },
    });
    if (before.status === input.status) return;

    await tx.user.update({
      where: { id: input.userId },
      data: {
        status: input.status,
        statusReason: input.reason,
        statusChangedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: `user.status.${input.status.toLowerCase()}`,
        targetType: "User",
        targetId: input.userId,
        before: { status: before.status, reason: before.statusReason },
        after: { status: input.status, reason: input.reason },
      },
    });
  });
}

export class GoogleAccountConflict extends Error {
  constructor() {
    super("That email is already linked to a different Google account.");
    this.name = "GoogleAccountConflict";
  }
}

/**
 * Resolves a verified Google identity to a user: first by Google id, then by
 * email (linking the Google id to the existing account and marking its email
 * verified — Google vouched for it), else creates a new user. `passwordHash`
 * is only used on create; callers pass a hash of random bytes so a Google-only
 * account can't be signed into with a password. Never writes `role`.
 */
export async function findOrCreateGoogleUser(input: {
  sub: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  passwordHash: string;
}): Promise<{ userId: string; created: boolean }> {
  const bySub = await prisma.user.findUnique({ where: { googleSub: input.sub }, select: { id: true } });
  if (bySub) return { userId: bySub.id, created: false };

  const email = input.email.toLowerCase();
  const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true, googleSub: true } });
  if (byEmail) {
    if (byEmail.googleSub && byEmail.googleSub !== input.sub) throw new GoogleAccountConflict();
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { googleSub: input.sub, emailVerified: true },
    });
    return { userId: byEmail.id, created: false };
  }

  const user = await prisma.user.create({
    data: {
      email,
      googleSub: input.sub,
      emailVerified: true,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
    },
    select: { id: true },
  });
  return { userId: user.id, created: true };
}
