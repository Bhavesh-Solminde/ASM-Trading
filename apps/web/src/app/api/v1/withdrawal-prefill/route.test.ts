import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WithdrawalPrefillSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `wp-${randomUUID()}@test.local`,
      passwordHash: "x",
      firstName: "Asha",
      lastName: "Rao",
      kycStatus: "VERIFIED",
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/withdrawal-prefill", () => {
  it("refuses a signed-out caller", async () => {
    expect((await GET(new NextRequest("http://localhost/api/v1/withdrawal-prefill"))).status).toBe(401);
  });

  it("returns the KYC name and status with no previous payouts", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/withdrawal-prefill", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    const body = WithdrawalPrefillSchema.parse(await res.json());
    expect(body).toMatchObject({ kycName: "Asha Rao", kycStatus: "VERIFIED", initialMethod: null, heldWithdrawals: [] });
  });
});
