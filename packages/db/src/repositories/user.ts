import { logger } from "@asm/logger";
import { prisma } from "../client";
import type { Prisma, UserStatus } from "../../generated/prisma/client";
import type { User } from "../models";

/**
 * Users are not user-owned rows in the same sense — a person looks up only
 * themselves, and login looks up by email before any session exists. Neither
 * function ever accepts or writes `role`.
 */

/** "main" = the regular site (USER + ADMIN); "affiliate" = live affiliate accounts. */
export type Portal = "main" | "affiliate";

/** Rows a portal can reach. Legacy simulated affiliates are reachable from neither. */
export function portalWhere(portal: Portal): Prisma.UserWhereInput {
  return portal === "main"
    ? { role: { in: ["USER", "ADMIN"] }, legacySimulated: false }
    : { role: "AFFILIATE", legacySimulated: false };
}

export async function findUserByEmail(email: string, portal: Portal = "main"): Promise<User | null> {
  const rows = await prisma.user.findMany({ where: { email: email.toLowerCase(), ...portalWhere(portal) }, take: 2 });
  if (rows.length > 1) {
    // A USER and an ADMIN row share this email; refuse rather than guess which one.
    logger.error({ evt: "auth.ambiguous_email", portal, userIds: rows.map((r) => r.id) }, "email matches several accounts");
    return null;
  }
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
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

const portalSelect = { role: true, legacySimulated: true } as const;
function inMainPortal(u: { role: string; legacySimulated: boolean }): boolean {
  return (u.role === "USER" || u.role === "ADMIN") && !u.legacySimulated;
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
 * verified — Google vouched for it), else creates a new user. Main portal only:
 * an affiliate row with the same email is neither linked nor a blocker. `passwordHash`
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
  const bySub = await prisma.user.findUnique({ where: { googleSub: input.sub }, select: { id: true, ...portalSelect } });
  if (bySub) {
    // Google sign-in is main-portal only; a sub somehow on another row never opens it.
    if (!inMainPortal(bySub)) throw new GoogleAccountConflict();
    return { userId: bySub.id, created: false };
  }

  const email = input.email.toLowerCase();
  const matches = await prisma.user.findMany({
    where: { email, ...portalWhere("main") },
    select: { id: true, googleSub: true },
    take: 2,
  });
  if (matches.length > 1) throw new GoogleAccountConflict();
  const byEmail = matches[0];
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
