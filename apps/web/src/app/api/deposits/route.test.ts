import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { GET, POST } from "./route";

const RUN = randomUUID();
let userId = "";
let cookie = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `deposit-route-${RUN}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  cookie = await createSession(userId, {});
});

afterAll(async () => {
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

function headers(sessionCookie: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (sessionCookie) h["cookie"] = `${SESSION_COOKIE}=${sessionCookie}`;
  return h;
}

function post(body: unknown, sessionCookie: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/deposits", {
      method: "POST",
      headers: headers(sessionCookie),
      body: JSON.stringify(body),
    }),
  );
}

function get(sessionCookie: string | null): Promise<Response> {
  return GET(new NextRequest("http://localhost/api/deposits", { headers: headers(sessionCookie) }));
}

describe("POST /api/deposits", () => {
  it("requires a session", async () => {
    expect((await post({ method: "PhonePe", amountUsd: 10_000 }, null)).status).toBe(401);
  });

  it("creates a deposit intent and returns a checkout token", async () => {
    const res = await post({ method: "PhonePe", amountUsd: 10_000 }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { checkoutToken: string };
    expect(typeof body.checkoutToken).toBe("string");
    expect(body.checkoutToken.length).toBeGreaterThan(0);
  });
});

describe("GET /api/deposits", () => {
  it("requires a session", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("lists the caller's own deposits", async () => {
    const res = await get(cookie);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { deposits: { method: string; amountUsd: number }[] };
    expect(body.deposits.length).toBeGreaterThanOrEqual(1);
    expect(body.deposits[0]).toMatchObject({ method: "PhonePe", amountUsd: 10_000 });
  });
});
