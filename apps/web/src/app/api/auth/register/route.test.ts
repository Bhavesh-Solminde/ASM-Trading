import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn<
    (input: { to: string; userId: string; name: string; firstDepositBonusPercent: number }) => Promise<{ ok: true; id: string }>
  >(async () => ({ ok: true, id: "em" })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { ensureReferralCode, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { readSession } from "@/lib/session";
import { POST } from "./route";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => mail.sendWelcomeEmail.mockClear());

function register(email: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), ...headers },
      body: JSON.stringify({ name: "Asha Rao", email, password: "correct-horse-battery", ...extra }),
    }),
  );
}

describe("register welcome email", () => {
  it("welcomes a new account by first name with the first-deposit bonus", async () => {
    const email = `welcome-${RUN}@test.local`;
    const res = await register(email);
    expect(res.status).toBe(201);
    const { userId } = (await res.json()) as { userId: string };
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, userId, name: "Asha", firstDepositBonusPercent: 100 }),
    );
  });

  it("sends nothing when the email is already registered", async () => {
    const email = `dupe-${RUN}@test.local`;
    await register(email);
    mail.sendWelcomeEmail.mockClear();
    expect((await register(email)).status).toBe(409);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe("register session for the app", () => {
  it("returns an app session token in the body, without a cookie", async () => {
    const email = `reg-app-${RUN}@test.local`;
    const res = await register(email, { "x-client": "app/1.0.0", "x-device-name": "Pixel 8" });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { token: string; userId: string };
    expect(typeof body.token).toBe("string");
    expect((await readSession(body.token))?.client).toBe("APP");
  });

  it("keeps the cookie response for the website", async () => {
    const res = await register(`reg-web-${RUN}@test.local`);
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=/);
    expect(Object.keys((await res.json()) as object)).toEqual(["userId"]);
  });
});

describe("register referral", () => {
  async function inviter(tag: string, data: { email?: string; role?: "AFFILIATE" } = {}) {
    const u = await prisma.user.create({
      data: { email: data.email ?? `inv-${tag}-${RUN}@test.local`, passwordHash: "x", ...(data.role && { role: data.role }) },
    });
    return { id: u.id, code: await ensureReferralCode(u.id) };
  }
  const referredBy = async (email: string) =>
    (await prisma.user.findFirstOrThrow({ where: { email, role: "USER" } })).referredById;

  it("attaches the link cookie silently and clears it", async () => {
    const inv = await inviter("cookie");
    const email = `ref-cookie-${RUN}@test.local`;
    const res = await register(email, { cookie: `asm_ref=${inv.code}` });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/asm_ref=;/);
    expect(await referredBy(email)).toBe(inv.id);
    const row = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(row.referralVia).toBe("LINK");
  });

  it("a typed code beats the cookie", async () => {
    const viaCookie = await inviter("beat-cookie");
    const typed = await inviter("beat-typed");
    const email = `ref-typed-${RUN}@test.local`;
    const res = await register(email, { cookie: `asm_ref=${viaCookie.code}` }, { referralCode: typed.code.toLowerCase() });
    expect(res.status).toBe(201);
    const row = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(row).toMatchObject({ referredById: typed.id, referralVia: "CODE" });
  });

  it("an invalid typed code is a 400 and creates no user", async () => {
    const email = `ref-badtyped-${RUN}@test.local`;
    const res = await register(email, {}, { referralCode: "ZZZZZZZZ" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That invitation code isn't valid.", code: "invalid_referral" });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("refuses the person's own (affiliate) code before creating the user", async () => {
    const email = `ref-self-${RUN}@test.local`;
    const aff = await inviter("self", { email, role: "AFFILIATE" });
    const res = await register(email, {}, { referralCode: aff.code });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "You can't use your own invitation code.", code: "self_referral" });
    expect(await prisma.user.count({ where: { email, role: "USER" } })).toBe(0);
  });

  it("ignores an invalid cookie and still signs up", async () => {
    const email = `ref-badcookie-${RUN}@test.local`;
    const res = await register(email, { cookie: "asm_ref=ZZZZZZZZ" });
    expect(res.status).toBe(201);
    expect(await referredBy(email)).toBeNull();
  });

  it("affiliate-portal signups ignore both the code and the cookie", async () => {
    const inv = await inviter("aff-portal");
    const email = `ref-affportal-${RUN}@test.local`;
    const res = await register(email, { cookie: `asm_ref=${inv.code}` }, { portal: "affiliate", referralCode: "ZZZZZZZZ" });
    expect(res.status).toBe(201);
    const row = await prisma.user.findFirstOrThrow({ where: { email, role: "AFFILIATE" } });
    expect(row.referredById).toBeNull();
    expect(res.headers.get("set-cookie")).not.toMatch(/asm_ref=/);
  });

  it("app signups attach a typed code and keep the token-only response", async () => {
    const inv = await inviter("app");
    const email = `ref-app-${RUN}@test.local`;
    const res = await register(email, { "x-client": "app/1.0.0" }, { referralCode: inv.code });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await referredBy(email)).toBe(inv.id);
  });
});
