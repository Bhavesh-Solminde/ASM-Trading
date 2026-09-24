import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, type Role } from "@asm/db";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_TTL_MS,
} from "./session-cookie";

export { SESSION_COOKIE, SESSION_COOKIE_OPTIONS };

/** Tokens are stored hashed — a database leak must not yield usable sessions. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return token;
}

export type SessionReadResult = {
  userId: string;
  role: Role;
  /** True when readSession extended the DB expiry; the caller should re-issue the cookie. */
  refreshed: boolean;
};

/**
 * Role is read from the database on every request, never carried in the cookie.
 * A stolen or forged cookie cannot assert a role it does not have.
 *
 * When the session is within the refresh window the DB row's expiresAt and
 * lastUsedAt are bumped and `refreshed: true` is returned so the caller can
 * re-issue the cookie with a fresh Max-Age.
 */
export async function readSession(
  token: string | undefined,
): Promise<SessionReadResult | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() < now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const stored = Buffer.from(session.tokenHash, "hex");
  const supplied = Buffer.from(tokenHash, "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    return null;
  }

  // Sliding refresh: if the session is closer to expiry than the threshold,
  // roll it forward. Best-effort — a DB blip here shouldn't fail the read.
  let refreshed = false;
  const remainingMs = session.expiresAt.getTime() - now;
  if (remainingMs < SESSION_REFRESH_THRESHOLD_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: {
          expiresAt: new Date(now + SESSION_TTL_MS),
          lastUsedAt: new Date(now),
        },
      })
      .then(() => {
        refreshed = true;
      })
      .catch(() => {});
  }

  return { userId: session.user.id, role: session.user.role, refreshed };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}

/**
 * Delete every session for a user — used by "log out of every device"
 * from the account page.
 */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
