import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Sent = { ok: true; id: string };
const mail = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn<(input: { to: string; userId: string }) => Promise<Sent>>(async () => ({ ok: true, id: "em" })),
  sendVerifyEmail: vi.fn<(input: { to: string; tokenId: string; verifyUrl: string; ttlHours: number }) => Promise<Sent>>(
    async () => ({ ok: true, id: "em" }),
  ),
  sendPasswordResetEmail: vi.fn<(input: { to: string; resetUrl: string }) => Promise<Sent>>(async () => ({ ok: true, id: "em" })),
  sendPasswordChangedEmail: vi.fn<(input: { to: string; userId: string; resetPath?: string }) => Promise<Sent>>(
    async () => ({ ok: true, id: "em" }),
  ),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { findUserByEmail, issueEmailVerificationToken, prisma } from "@asm/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { redis } from "@/lib/redis";
import { createSession } from "@/lib/session";
import { POST as login } from "./login/route";
import { POST as confirmReset } from "./password-reset/confirm/route";
import { POST as requestReset } from "./password-reset/request/route";
import { POST as register } from "./register/route";
import { POST as resend } from "./verify-email/resend/route";
import { GET as verify } from "./verify-email/route";

const RUN = randomUUID();
const mkEmail = (key: string) => `${key}-${RUN}@test.local`;
const USER_PW = "user-password-123";
const AFF_PW = "affiliate-password-456";

afterAll(async () => {
  // AuditLog is append-only for the app role, so reset audit rows stay behind.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  for (const fn of Object.values(mail)) fn.mockClear();
});

// A fresh fake IP per request: no IP throttle carries across tests, and a
// non-public IP skips the VPN lookup.
function post(handler: (req: NextRequest) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new NextRequest(`http://localhost/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function signUp(email: string, portal?: "user" | "affiliate", password = portal === "affiliate" ? AFF_PW : USER_PW) {
  const res = await post(register, "register", { name: "Asha Rao", email, password, ...(portal && { portal }) });
  const body = (await res.json()) as { userId?: string; error?: string };
  return { status: res.status, userId: body.userId ?? "" };
}

async function signIn(email: string, password: string, portal?: "user" | "affiliate") {
  const res = await post(login, "login", { email, password, ...(portal && { portal }) });
  const body = (await res.json()) as { userId?: string; error?: string };
  return { status: res.status, userId: body.userId ?? null };
}

function verifyGet(token: string) {
  return verify(new NextRequest(`http://localhost/api/auth/verify-email?token=${encodeURIComponent(token)}`));
}

function lastVerifyToken(): string {
  return new URL(mail.sendVerifyEmail.mock.calls.at(-1)![0].verifyUrl).searchParams.get("token")!;
}

async function legacyAffiliate(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: await hashPassword(AFF_PW), role: "AFFILIATE", legacySimulated: true, status: "BANNED" },
  });
}

describe("separate accounts per portal", () => {
  const shared = mkEmail("shared");
  let userId = "";
  let affiliateId = "";

  it("lets one email register as a user and as an affiliate, as two separate accounts", async () => {
    const u = await signUp(shared);
    const a = await signUp(shared, "affiliate");
    expect(u.status).toBe(201);
    expect(a.status).toBe(201);
    userId = u.userId;
    affiliateId = a.userId;
    expect(affiliateId).not.toBe(userId);

    const rows = await prisma.user.findMany({ where: { email: shared }, include: { accounts: true } });
    const user = rows.find((r) => r.id === userId)!;
    const aff = rows.find((r) => r.id === affiliateId)!;
    expect(user).toMatchObject({ role: "USER", legacySimulated: false });
    expect(aff).toMatchObject({ role: "AFFILIATE", legacySimulated: false, emailVerified: false });
    expect(await prisma.affiliateProfile.findUnique({ where: { userId } })).toBeNull(); // regular account: no profile
    expect((await prisma.affiliateProfile.findUniqueOrThrow({ where: { userId: affiliateId } })).status).toBe("PENDING_VERIFICATION");
    expect(aff.accounts.map((x) => x.type).sort()).toEqual(user.accounts.map((x) => x.type).sort());
    const userAccounts = new Set(user.accounts.map((x) => x.id));
    expect(aff.accounts.some((x) => userAccounts.has(x.id))).toBe(false);
  });

  it("sends the affiliate a verification link, not the deposit-bonus welcome", async () => {
    const email = mkEmail("mails");
    await signUp(email, "affiliate");
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(mail.sendVerifyEmail).toHaveBeenCalledWith(expect.objectContaining({ to: email, ttlHours: 24 }));
    expect(mail.sendVerifyEmail.mock.calls[0]![0].verifyUrl).toMatch(/\/api\/auth\/verify-email\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("signs each portal into its own row with its own password", async () => {
    expect(await signIn(shared, USER_PW)).toEqual({ status: 200, userId });
    expect(await signIn(shared, USER_PW, "user")).toEqual({ status: 200, userId });
    expect(await signIn(shared, AFF_PW, "affiliate")).toEqual({ status: 200, userId: affiliateId });
    expect((await signIn(shared, AFF_PW)).status).toBe(401);
    expect((await signIn(shared, USER_PW, "affiliate")).status).toBe(401);
  });

  it("keeps an affiliate-only email out of the user login, and vice versa, with the same reply", async () => {
    const affOnly = mkEmail("aff-only");
    const userOnly = mkEmail("user-only");
    await signUp(affOnly, "affiliate");
    await signUp(userOnly);
    const res = await post(login, "login", { email: affOnly, password: AFF_PW });
    expect(res.status).toBe(401);
    const wrongPortal = (await res.json()) as unknown;
    const res2 = await post(login, "login", { email: userOnly, password: USER_PW, portal: "affiliate" });
    expect(res2.status).toBe(401);
    expect(await res2.json()).toEqual(wrongPortal);
  });

  it("answers 409 for a duplicate within the same portal", async () => {
    expect((await signUp(shared)).status).toBe(409);
    expect((await signUp(shared, "affiliate")).status).toBe(409);
  });

  it("answers one 201 and 409s, never a 500, when the same email signs up concurrently", async () => {
    const email = mkEmail("race");
    const statuses = (await Promise.all([1, 2, 3].map(() => signUp(email, "affiliate")))).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(await prisma.user.count({ where: { email, role: "AFFILIATE" } })).toBe(1);
  });

  it("refuses a main-portal signup for an email an admin holds", async () => {
    const email = mkEmail("admin");
    await prisma.user.create({ data: { email, passwordHash: "x", role: "ADMIN" } });
    expect((await signUp(email)).status).toBe(409);
    expect((await signUp(email, "affiliate")).status).toBe(201);
  });

  it("does not let a retired simulated affiliate block a new affiliate or sign in", async () => {
    const email = mkEmail("legacy");
    const legacy = await legacyAffiliate(email);
    expect((await signIn(email, AFF_PW, "affiliate")).status).toBe(401);
    const fresh = await signUp(email, "affiliate");
    expect(fresh.status).toBe(201);
    expect(fresh.userId).not.toBe(legacy.id);
    expect(await signIn(email, AFF_PW, "affiliate")).toEqual({ status: 200, userId: fresh.userId });
  });
});

describe("email verification", () => {
  it("verifies once, then reads as invalid", async () => {
    const email = mkEmail("verify");
    const { userId } = await signUp(email, "affiliate");
    const token = lastVerifyToken();
    const profileStatus = async () => (await prisma.affiliateProfile.findUniqueOrThrow({ where: { userId } })).status;
    expect(await profileStatus()).toBe("PENDING_VERIFICATION"); // created with the signup

    const ok = await verifyGet(token);
    expect(await profileStatus()).toBe("ACTIVE");
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/affiliate/dashboard?verified=1");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);

    expect((await verifyGet(token)).headers.get("location")).toBe("/affiliate/dashboard?verify=invalid");
  });

  it("rejects unknown, malformed and expired tokens", async () => {
    expect((await verifyGet("x".repeat(43))).headers.get("location")).toBe("/affiliate/dashboard?verify=invalid");
    expect((await verifyGet("")).headers.get("location")).toBe("/affiliate/dashboard?verify=invalid");

    const { userId } = await signUp(mkEmail("expired"), "affiliate");
    const issued = await issueEmailVerificationToken(userId);
    await prisma.emailVerificationToken.update({ where: { id: issued.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyGet(issued.token)).headers.get("location")).toBe("/affiliate/dashboard?verify=invalid");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(false);
  });
});

describe("verification resend", () => {
  const bearer = async (userId: string) => ({ authorization: `Bearer ${await createSession(userId, {})}` });
  const SENT = { ok: true, message: "If your email still needs verifying, we've sent a new link. Check your inbox." };

  it("needs a session", async () => {
    expect((await post(resend, "verify-email/resend", {})).status).toBe(401);
  });

  it("re-sends to an unverified affiliate and kills the older link", async () => {
    const { userId } = await signUp(mkEmail("resend"), "affiliate");
    const first = lastVerifyToken();
    const res = await post(resend, "verify-email/resend", {}, await bearer(userId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SENT);
    expect(mail.sendVerifyEmail).toHaveBeenCalledTimes(2);
    expect(lastVerifyToken()).not.toBe(first);
    expect((await verifyGet(first)).headers.get("location")).toBe("/affiliate/dashboard?verify=invalid");
  });

  it("gives the same reply but sends nothing to a regular user or a verified affiliate", async () => {
    const user = await signUp(mkEmail("resend-user"));
    const aff = await signUp(mkEmail("resend-verified"), "affiliate");
    await verifyGet(lastVerifyToken());
    mail.sendVerifyEmail.mockClear();
    for (const id of [user.userId, aff.userId]) {
      const res = await post(resend, "verify-email/resend", {}, await bearer(id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(SENT);
    }
    expect(mail.sendVerifyEmail).not.toHaveBeenCalled();
  });

  it("throttles one account after three requests an hour", async () => {
    const { userId } = await signUp(mkEmail("resend-rl"), "affiliate");
    const headers = await bearer(userId);
    for (let i = 0; i < 3; i++) expect((await post(resend, "verify-email/resend", {}, headers)).status).toBe(200);
    expect((await post(resend, "verify-email/resend", {}, headers)).status).toBe(429);
  });
});

describe("password reset per portal", () => {
  const email = mkEmail("reset");
  let userId = "";
  let affiliateId = "";

  function tokenFromLastEmail(): string {
    return new URL(mail.sendPasswordResetEmail.mock.calls.at(-1)![0].resetUrl).searchParams.get("token")!;
  }

  it("resets only the affiliate row from the affiliate portal and points back to its login", async () => {
    userId = (await signUp(email)).userId;
    affiliateId = (await signUp(email, "affiliate")).userId;

    const req = await post(requestReset, "password-reset/request", { email, portal: "affiliate" });
    expect(req.status).toBe(200);
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    const res = await post(confirmReset, "password-reset/confirm", { token: tokenFromLastEmail(), password: "new-affiliate-pass-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, loginPath: "/affiliate/login" });
    expect(mail.sendPasswordChangedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ userId: affiliateId, resetPath: "/affiliate/forgot-password" }),
    );

    const [user, aff] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: affiliateId } }),
    ]);
    expect(await verifyPassword(aff.passwordHash, "new-affiliate-pass-1")).toBe(true);
    expect(await verifyPassword(user.passwordHash, USER_PW)).toBe(true);
  });

  it("resets the regular row by default and points back to /login", async () => {
    await post(requestReset, "password-reset/request", { email });
    const res = await post(confirmReset, "password-reset/confirm", { token: tokenFromLastEmail(), password: "new-user-pass-123" });
    expect(await res.json()).toEqual({ ok: true, loginPath: "/login" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(user.passwordHash, "new-user-pass-123")).toBe(true);
  });

  it("gives admins, legacy rows and the other portal's emails the generic reply and no link", async () => {
    const admin = mkEmail("reset-admin");
    const legacy = mkEmail("reset-legacy");
    const userOnly = mkEmail("reset-user-only");
    await prisma.user.create({ data: { email: admin, passwordHash: "x", role: "ADMIN" } });
    await legacyAffiliate(legacy);
    await signUp(userOnly);
    mail.sendPasswordResetEmail.mockClear();

    const replies = await Promise.all([
      post(requestReset, "password-reset/request", { email: admin }),
      post(requestReset, "password-reset/request", { email: legacy, portal: "affiliate" }),
      post(requestReset, "password-reset/request", { email: userOnly, portal: "affiliate" }),
    ]);
    const generic = await post(requestReset, "password-reset/request", { email: mkEmail("nobody") });
    const expected = (await generic.json()) as unknown;
    for (const r of replies) {
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual(expected);
    }
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("findUserByEmail scope", () => {
  it("returns null rather than guess when a USER and an ADMIN share an email", async () => {
    const email = mkEmail("ambiguous");
    await prisma.user.create({ data: { email, passwordHash: "x" } });
    await prisma.user.create({ data: { email, passwordHash: "x", role: "ADMIN" } });
    expect(await findUserByEmail(email)).toBeNull();
    expect((await signIn(email, "anything-at-all-1")).status).toBe(401);
  });
});
