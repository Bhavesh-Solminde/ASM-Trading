import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { issuePasswordResetToken, resetPasswordWithToken } from "./password-reset";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `pw-reset-${randomUUID()}@test.local`, passwordHash: "old-hash", firstName: "Asha" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { targetType: "User", targetId: userId } });
  await prisma.user.delete({ where: { id: userId } }); // cascades tokens and sessions
  await prisma.$disconnect();
});

describe("password reset tokens", () => {
  it("stores only a hash of the token", async () => {
    const { id, token } = await issuePasswordResetToken({ userId });
    const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("sets the new password, verifies the email and signs out every device", async () => {
    await prisma.session.create({
      data: { userId, tokenHash: `t-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    const { token } = await issuePasswordResetToken({ userId });
    const result = await resetPasswordWithToken({ token, passwordHash: "new-hash" });

    expect(result?.userId).toBe(userId);
    expect(result?.firstName).toBe("Asha");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe("new-hash");
    expect(user.emailVerified).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it("works only once", async () => {
    const { token } = await issuePasswordResetToken({ userId });
    expect(await resetPasswordWithToken({ token, passwordHash: "h1" })).not.toBeNull();
    expect(await resetPasswordWithToken({ token, passwordHash: "h2" })).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe("h1");
  });

  it("refuses an expired token", async () => {
    const { id, token } = await issuePasswordResetToken({ userId });
    await prisma.passwordResetToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect(await resetPasswordWithToken({ token, passwordHash: "never" })).toBeNull();
  });

  it("kills the older link when a new one is issued", async () => {
    const first = await issuePasswordResetToken({ userId });
    const second = await issuePasswordResetToken({ userId });
    expect(await resetPasswordWithToken({ token: first.token, passwordHash: "never" })).toBeNull();
    expect(await resetPasswordWithToken({ token: second.token, passwordHash: "ok" })).not.toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await resetPasswordWithToken({ token: "x".repeat(43), passwordHash: "never" })).toBeNull();
  });
});
