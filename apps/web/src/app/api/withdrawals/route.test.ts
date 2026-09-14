import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountsForUser, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { GET, POST } from "./route";

const RUN = randomUUID();

let alice = { userId: "", liveId: "", cookie: "" };
let bob = { userId: "", liveId: "", cookie: "" };

async function makeUser(name: string) {
  const user = await prisma.user.create({
    data: { email: `${name}-withdrawals-${RUN}@test.local`, passwordHash: "x" },
  });
  const accounts = await createAccountsForUser(user.id, 1_000_000);
  return {
    userId: user.id,
    liveId: accounts.find((a) => a.type === "LIVE")!.id,
    cookie: await createSession(user.id, {}),
  };
}

beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function headers(cookie: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": randomUUID() };
  if (cookie) h["cookie"] = `${SESSION_COOKIE}=${cookie}`;
  return h;
}

function get(accountId: string | null, cookie: string | null): Promise<Response> {
  const url = accountId
    ? `http://localhost/api/withdrawals?accountId=${encodeURIComponent(accountId)}`
    : "http://localhost/api/withdrawals";
  return GET(new NextRequest(url, { headers: headers(cookie) }));
}

function post(body: unknown, cookie: string | null): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/withdrawals", {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify(body),
    }),
  );
}

describe("GET /api/withdrawals", () => {
  it("requires a session", async () => {
    expect((await get(alice.liveId, null)).status).toBe(401);
  });

  it("requires an accountId", async () => {
    expect((await get(null, alice.cookie)).status).toBe(400);
  });

  it("refuses an account the caller does not own", async () => {
    const res = await get(alice.liveId, bob.cookie);
    expect(res.status).toBe(404);
  });

  it("returns the withdrawable balance for the caller's own account", async () => {
    const res = await get(alice.liveId, alice.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balance: { withdrawable: number } };
    expect(body.balance.withdrawable).toBe(0);
  });
});

describe("POST /api/withdrawals", () => {
  it("requires a session", async () => {
    const res = await post(
      { accountId: alice.liveId, amount: 1_000, method: "PhonePe" },
      null,
    );
    expect(res.status).toBe(401);
  });

  it("refuses a method never used for a completed deposit", async () => {
    const res = await post(
      { accountId: alice.liveId, amount: 1_000, method: "PhonePe" },
      alice.cookie,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already deposited/i);
  });
});
