import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { wsTicketKey } from "@/lib/ws-ticket";
import { POST } from "./route";

let userId = "";
let sessionToken = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `ws-ticket-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  sessionToken = await createSession(userId, {});
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

function request(cookie: string | null): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": randomUUID() };
  if (cookie) headers["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return new NextRequest("http://localhost/api/auth/ws-ticket", { method: "POST", headers });
}

describe("POST /api/auth/ws-ticket", () => {
  it("refuses a request with no session", async () => {
    expect((await POST(request(null))).status).toBe(401);
  });

  it("issues a single-use ticket bound to the caller, without exposing the session token", async () => {
    const res = await POST(request(sessionToken));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket).not.toBe(sessionToken);
    expect(await redis.get(wsTicketKey(ticket))).toBe(userId);
    expect(await redis.ttl(wsTicketKey(ticket))).toBeLessThanOrEqual(30);
  });
});
