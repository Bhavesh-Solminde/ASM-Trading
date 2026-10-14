import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { hashPassword } from "@/lib/password";
import { readSession } from "@/lib/session";
import { POST } from "./route";

const email = `login-${randomUUID()}@test.local`;
const password = "correct horse battery";
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

function login(headers: Record<string, string>) {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), ...headers },
      body: JSON.stringify({ email, password }),
    }),
  );
}

describe("POST /api/auth/login", () => {
  it("returns an app session token in the body, without a cookie, for the app", async () => {
    const res = await login({ "x-client": "app/1.0.0", "x-device-name": "Pixel 8" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { token: string; userId: string };
    expect(body.userId).toBe(userId);
    expect((await readSession(body.token))?.client).toBe("APP");
  });

  it("keeps the cookie response for the website", async () => {
    const res = await login({});
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=/);
    expect(await res.json()).toEqual({ userId });
  });
});
