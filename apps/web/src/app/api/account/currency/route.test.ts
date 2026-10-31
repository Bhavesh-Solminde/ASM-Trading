import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { POST } from "./route";

const RUN = randomUUID();

let userId = "";
let liveId = "";
let demoId = "";
let cookie = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `currency-${RUN}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  const accounts = await createAccountsForUser(userId, 100_000_000, "INR");
  liveId = accounts.find((a) => a.type === "LIVE")!.id;
  demoId = accounts.find((a) => a.type === "DEMO")!.id;
  cookie = await createSession(userId, {});
});

afterAll(async () => {
  await redis.del(`rl:currency:${userId}`);
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function post(body: unknown, session: string | null = cookie): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (session) headers["cookie"] = `${SESSION_COOKIE}=${session}`;
  return POST(
    new NextRequest("http://localhost/api/account/currency", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/account/currency", () => {
  it("requires a session", async () => {
    expect((await post({ accountId: liveId, currency: "USD" }, null)).status).toBe(401);
  });

  it("rejects an unsupported currency", async () => {
    expect((await post({ accountId: liveId, currency: "EUR" })).status).toBe(400);
  });

  it("refuses with 409 and code pending_withdrawal while a withdrawal is in flight", async () => {
    const w = await prisma.withdrawal.create({
      data: { userId, amount: 5_000_000, method: "UPI", status: "HELD", currency: "INR" },
    });
    const res = await post({ accountId: liveId, currency: "USD" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Finish or cancel your pending withdrawal first.",
      code: "pending_withdrawal",
    });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: liveId } })).currency).toBe("INR");
    await prisma.withdrawal.delete({ where: { id: w.id } });
  });

  it("keeps the plain 409 (no code) for other refusals, e.g. an account that is not yours", async () => {
    const res = await post({ accountId: randomUUID(), currency: "USD" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Account not found." });
  });

  it("converts once the withdrawal is final", async () => {
    await prisma.withdrawal.create({
      data: { userId, amount: 5_000_000, method: "UPI", status: "PAID", currency: "INR" },
    });
    const res = await post({ accountId: liveId, currency: "USD" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ currency: "USD" });
  });

  it("converts a DEMO account regardless of withdrawals", async () => {
    await prisma.withdrawal.create({
      data: { userId, amount: 5_000_000, method: "UPI", status: "REQUESTED", currency: "INR" },
    });
    const res = await post({ accountId: demoId, currency: "USD" });
    expect(res.status).toBe(200);
  });

  it("rate-limits repeated switches with 429", async () => {
    await redis.set(`rl:currency:${userId}`, "10", "EX", 300);
    const res = await post({ accountId: demoId, currency: "INR" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/too many/i);
  });
});
