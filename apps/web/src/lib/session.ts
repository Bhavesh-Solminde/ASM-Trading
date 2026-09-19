import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma, type Role } from "@asm/db";

export const SESSION_COOKIE = "asm_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

/**
 * Role is read from the database on every request, never carried in the cookie.
 * A stolen or forged cookie cannot assert a role it does not have.
 */
export async function readSession(
  token: string | undefined,
): Promise<{ userId: string; role: Role } | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const stored = Buffer.from(session.tokenHash, "hex");
  const supplied = Buffer.from(hashToken(token), "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    return null;
  }

  return { userId: session.user.id, role: session.user.role };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session
    .delete({ where: { tokenHash: hashToken(token) } })
    .catch(() => {});
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
