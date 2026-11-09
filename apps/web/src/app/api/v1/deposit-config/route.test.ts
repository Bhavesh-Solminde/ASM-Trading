import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DepositConfigSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";
beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `dc-${randomUUID()}@test.local`, passwordHash: "x" } });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/deposit-config", () => {
  it("returns the deposit options in the agreed shape", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/deposit-config", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    expect(DepositConfigSchema.parse(await res.json()).completedDeposits).toBe(0);
  });
});
