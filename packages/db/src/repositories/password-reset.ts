import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../client";

/** How long an emailed reset link works. The email copy states it in minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a single-use reset token for the emailed link. Every earlier unused
 * token for the user dies first, so only the newest email works. Returns the
 * raw token (goes in the link, never stored) and the row id (the email's
 * idempotency key).
 */
export async function issuePasswordResetToken(input: {
  userId: string;
  ipAddress?: string | null;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  const row = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return tx.passwordResetToken.create({
      data: { userId: input.userId, tokenHash: hashToken(token), expiresAt, ipAddress: input.ipAddress ?? null },
      select: { id: true },
    });
  });
  return { id: row.id, token, expiresAt };
}

/**
 * Spends a reset token and sets the new password in one transaction. The
 * token claim is conditional (unused and unexpired), so a replayed or racing
 * link loses. Every session is deleted, which signs the user out on all
 * devices. The email counts as verified, since only the inbox owner could
 * open the link. Returns null for an unknown, used or expired token. The
 * caller hashes the password first (argon2 lives in the web app).
 */
export async function resetPasswordWithToken(input: {
  token: string;
  passwordHash: string;
  ipAddress?: string | null;
}): Promise<{ userId: string; email: string; firstName: string | null; lastName: string | null; nickname: string | null } | null> {
  const tokenHash = hashToken(input.token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!row) return null;

    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const user = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: input.passwordHash, emailVerified: true },
      select: { id: true, email: true, firstName: true, lastName: true, nickname: true },
    });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await tx.auditLog.create({
      data: {
        actorId: row.userId,
        action: "auth.password_reset",
        targetType: "User",
        targetId: row.userId,
        after: { via: "email_link", ip: input.ipAddress ?? null },
      },
    });
    return { userId: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, nickname: user.nickname };
  });
}
