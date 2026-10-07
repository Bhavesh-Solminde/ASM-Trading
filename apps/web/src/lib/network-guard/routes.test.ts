// apps/web/src/lib/network-guard/routes.test.ts
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { hashPassword } from "@/lib/password";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE } from "@/lib/session";
import { verdictCacheKey } from "./lookup";

// Fresh documentation-range IPv6 addresses per run, so per-IP rate-limit keys
// never carry over between runs. The verdict cache is seeded, so nothing here
// ever reaches ipapi.is.
function randomPublicIp(): string {
  return `2001:db8::${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}`;
}
const VPN_IP = randomPublicIp();
const CLEAN_IP = randomPublicIp();
const PASSWORD = "correct-horse-battery-staple";
const NEW_EMAIL_PREFIX = `vpn-guard-new-${randomUUID()}`;

let previousMode: string | undefined;
let userId = "";
let email = "";

beforeAll(async () => {
  previousMode = process.env.VPN_BLOCK_MODE;
  process.env.VPN_BLOCK_MODE = "block";
  await redis.set(verdictCacheKey(VPN_IP), "vpn", "EX", 600);
  await redis.set(verdictCacheKey(CLEAN_IP), "clean", "EX", 600);
  email = `vpn-guard-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(PASSWORD) },
  });
  userId = user.id;
});

afterAll(async () => {
  if (previousMode === undefined) delete process.env.VPN_BLOCK_MODE;
  else process.env.VPN_BLOCK_MODE = previousMode;
  await redis.del(verdictCacheKey(VPN_IP), verdictCacheKey(CLEAN_IP));
  await prisma.user.deleteMany({
    where: { OR: [{ id: userId }, { email: { startsWith: NEW_EMAIL_PREFIX } }] },
  });
  await prisma.$disconnect();
  await redis.quit();
});

function post(path: string, ip: string, body: unknown, session?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", "x-real-ip": ip };
  if (session) headers.cookie = `${SESSION_COOKIE}=${session}`;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("VPN guard on auth routes", () => {
  it("refuses to create an account from a VPN", async () => {
    const newEmail = `${NEW_EMAIL_PREFIX}-a@test.local`;
    const res = await register(post("/api/auth/register", VPN_IP, { email: newEmail, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("vpn_blocked");
    expect(await prisma.user.findUnique({ where: { email: newEmail } })).toBeNull();
  });

  it("still registers from a clean network", async () => {
    const newEmail = `${NEW_EMAIL_PREFIX}-b@test.local`;
    const res = await register(post("/api/auth/register", CLEAN_IP, { email: newEmail, password: PASSWORD }));
    expect(res.status).toBe(201);
  });

  it("refuses a correct login from a VPN and issues no session", async () => {
    const res = await login(post("/api/auth/login", VPN_IP, { email, password: PASSWORD }));
    expect(res.status).toBe(403);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("lets an exempt user log in through a VPN", async () => {
    await prisma.user.update({ where: { id: userId }, data: { vpnExempt: true } });
    try {
      const res = await login(post("/api/auth/login", VPN_IP, { email, password: PASSWORD }));
      expect(res.status).toBe(200);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { vpnExempt: false } });
    }
  });
});
