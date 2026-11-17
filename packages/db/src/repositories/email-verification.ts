import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../client";
import { onAffiliateEmailVerified } from "./affiliate-profile";

/** How long an emailed verification link works. The email copy states it in hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a single-use verification token. Earlier unused tokens for the user
 * die first, so only the newest email works. Returns the raw token (goes in
 * the link, never stored) and the row id (the email's idempotency key).
 */
export async function issueEmailVerificationToken(userId: string): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const row = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    return tx.emailVerificationToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
      select: { id: true },
    });
  });
  return { id: row.id, token };
}

/**
 * Spends a verification token, marks the email verified and moves an
 * affiliate profile out of PENDING_VERIFICATION, in one transaction. The claim is conditional (unused and unexpired), so a replayed
 * or racing link loses. Returns null for an unknown, used or expired token.
 */
export async function consumeEmailVerificationToken(token: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!row) return null;
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;
    await tx.user.update({ where: { id: row.userId }, data: { emailVerified: true } });
    // Affiliate access follows the email (ACTIVE or PENDING_APPROVAL); a no-op for regular users.
    await onAffiliateEmailVerified(row.userId, tx, now);
    return { userId: row.userId };
  });
}
