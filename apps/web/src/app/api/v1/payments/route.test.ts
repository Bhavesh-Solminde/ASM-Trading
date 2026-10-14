import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PaymentsPageSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `payments-${randomUUID()}@test.local`,
      passwordHash: "x",
      accounts: { create: [{ type: "LIVE" }, { type: "DEMO" }] },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
  const base = Date.now() - 60_000;
  for (let i = 0; i < 5; i++) {
    await prisma.deposit.create({
      data: {
        userId,
        method: "UPI",
        amountUsd: 1200,
        amountInr: 100_000 + i,
        vpa: "test@upi",
        checkoutToken: randomUUID(),
        correlationId: randomUUID(),
        expiresAt: new Date(base + 300_000),
        createdAt: new Date(base + i * 1000),
      },
    });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const get = (query: string) =>
  GET(new NextRequest(`http://localhost/api/v1/payments${query}`, { headers: { authorization: `Bearer ${token}` } }));

describe("GET /api/v1/payments", () => {
  it("pages newest-first without repeating or skipping rows", async () => {
    const first = PaymentsPageSchema.parse(await (await get("?limit=2")).json());
    expect(first.rows).toHaveLength(2);
    const second = PaymentsPageSchema.parse(await (await get(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)).json());
    const third = PaymentsPageSchema.parse(await (await get(`?limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`)).json());
    const ids = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    expect((await get("?cursor=yesterday")).status).toBe(400);
  });
});
