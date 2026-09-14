import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { logger } from "@asm/logger";
import { prisma } from "../client";

const CODE_TTL_MS = 10 * 60_000;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Issues a code and DELIVERS IT TO THE LOG.
 *
 * No SMTP, no provider, no credentials — for a demonstration this shows the
 * flow exactly as well as email would, and a real sender is one adapter away.
 * Read the code from the engine or web terminal.
 *
 * Returns the code so tests can use it. Nothing in the request path returns it
 * to a caller.
 */
export async function issueTwoFactorCode(userId: string, purpose: string): Promise<string> {
  // Any earlier unused code for this purpose is dead the moment a new one is
  // issued, so an attacker cannot keep an old code alive by requesting more.
  await prisma.twoFactorCode.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await prisma.twoFactorCode.create({
    data: {
      userId,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  logger.info(
    { evt: "auth.2fa_sent", userId, purpose, code },
    `two-factor code for ${purpose}: ${code}`,
  );

  return code;
}

export async function verifyTwoFactorCode(
  userId: string,
  purpose: string,
  code: string,
): Promise<boolean> {
  const row = await prisma.twoFactorCode.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!row) return false;

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.twoFactorCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return false;
  }

  const expected = Buffer.from(row.codeHash, "hex");
  const supplied = Buffer.from(hashCode(code), "hex");
  const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);

  if (!matches) {
    logger.info({ evt: "auth.2fa_failed", userId, purpose }, "2fa code rejected");
    return false;
  }

  // Single-use. Claim it conditionally so a concurrent replay loses the race.
  const claimed = await prisma.twoFactorCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return claimed.count === 1;
}
