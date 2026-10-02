import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUsdtDepositIntent, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE, createSession } from "@/lib/session";
import { POST } from "./route";

const RUN = randomUUID();
let userId = "";
let otherUserId = "";
let cookie = "";
let otherCookie = "";
let depositId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `usdt-claim-route-${RUN}@test.local`, passwordHash: "x" },
  });
  const other = await prisma.user.create({
    data: { email: `usdt-claim-route-other-${RUN}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
  otherUserId = other.id;
  cookie = await createSession(userId, {});
  otherCookie = await createSession(otherUserId, {});

  const deposit = await createUsdtDepositIntent({
    userId,
    amountUsdtMinorRequested: 2_500,
    network: "tron",
    tokenContract: "TTestContract11111111111111111111",
    receivingAddress: "TTestReceiving111111111111111111",
    correlationId: randomUUID(),
  });
  depositId = deposit.id;
});

afterAll(async () => {
  await prisma.deposit.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await prisma.$disconnect();
  await redis.quit();
});

function post(id: string, body: unknown, sessionCookie: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": randomUUID(),
  };
  if (sessionCookie) headers["cookie"] = `${SESSION_COOKIE}=${sessionCookie}`;
  return POST(
    new NextRequest(`http://localhost/api/deposits/${id}/usdt-claim`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/deposits/[id]/usdt-claim", () => {
  it("requires a session", async () => {
    const res = await post(depositId, { txHash: randomBytes(32).toString("hex") }, null);
    expect(res.status).toBe(401);
  });

  it("rejects a malformed hash", async () => {
    const res = await post(depositId, { txHash: "not-a-hash" }, cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Paste the 64-character transaction hash from your wallet.",
    );
  });

  it("stores a 0x-prefixed uppercase hash lowercased without 0x, status untouched", async () => {
    const hash = randomBytes(32).toString("hex");
    const res = await post(depositId, { txHash: `  0x${hash.toUpperCase()} ` }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const d = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(d.claimedTxHash).toBe(hash);
    expect(d.status).toBe("AWAITING_PAYMENT");
  });

  it("returns 404 for another user's deposit and leaves it untouched", async () => {
    const before = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    const res = await post(depositId, { txHash: randomBytes(32).toString("hex") }, otherCookie);
    expect(res.status).toBe(404);
    const after = await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(after.claimedTxHash).toBe(before.claimedTxHash);
  });
});
