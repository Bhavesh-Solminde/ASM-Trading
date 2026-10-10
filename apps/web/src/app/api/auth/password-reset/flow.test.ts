import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(
    async (_input: { to: string; tokenId: string; name: string; resetUrl: string; ttlMinutes: number }) => ({ ok: true as const, id: "em" }),
  ),
  sendPasswordChangedEmail: vi.fn(async (_input: { to: string; userId: string; name: string; changedAt: Date }) => ({
    ok: true as const,
    id: "em",
  })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { redis } from "@/lib/redis";
import { createSession } from "@/lib/session";
import { POST as confirmReset } from "./confirm/route";
import { POST as requestReset } from "./request/route";

const RUN = randomUUID();
const EMAIL = `reset-${RUN}@test.local`;
let userId = "";
let spentToken = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword("old-password-123"), firstName: "Asha" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { targetType: "User", action: "auth.password_reset", targetId: userId } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  mail.sendPasswordResetEmail.mockClear();
  mail.sendPasswordChangedEmail.mockClear();
});

function call(handler: (req: NextRequest) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new NextRequest(`http://localhost/api/auth/password-reset/${path}`, {
      method: "POST",
      // A fresh fake IP per request: no IP throttle carries across tests, and
      // a non-public IP skips the VPN lookup.
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID() },
      body: JSON.stringify(body),
    }),
  );
}

function tokenFromLastEmail(): string {
  const url = mail.sendPasswordResetEmail.mock.calls.at(-1)![0].resetUrl;
  return new URL(url).searchParams.get("token")!;
}

describe("password reset flow", () => {
  it("answers the same for an unknown email and sends nothing", async () => {
    const res = await call(requestReset, "request", { email: `nobody-${RUN}@test.local` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("emails a reset link to a registered user", async () => {
    const res = await call(requestReset, "request", { email: EMAIL.toUpperCase() });
    expect(res.status).toBe(200);
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const input = mail.sendPasswordResetEmail.mock.calls[0]![0];
    expect(input.to).toBe(EMAIL);
    expect(input.ttlMinutes).toBe(30);
    expect(input.resetUrl).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a password under 12 characters with the rule's own message", async () => {
    const res = await call(confirmReset, "confirm", { token: "x".repeat(43), password: "short" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/12 characters/);
  });

  it("resets the password, signs out every device and sends a notice", async () => {
    await createSession(userId, {});
    await call(requestReset, "request", { email: EMAIL });
    spentToken = tokenFromLastEmail();

    const res = await call(confirmReset, "confirm", { token: spentToken, password: "brand-new-password-1" });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(user.passwordHash, "brand-new-password-1")).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(mail.sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL, userId }));
  });

  it("refuses a link that was already used", async () => {
    const res = await call(confirmReset, "confirm", { token: spentToken, password: "another-password-22" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/invalid or has expired/);
  });

  it("does not issue links for affiliate accounts", async () => {
    const email = `aff-${RUN}@test.local`;
    await prisma.user.create({ data: { email, passwordHash: "x", role: "AFFILIATE" } });
    const res = await call(requestReset, "request", { email });
    expect(res.status).toBe(200);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
