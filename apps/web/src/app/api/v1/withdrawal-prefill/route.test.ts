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

  it("sends each held withdrawal with the time its cancel window closes (null when it has none)", async () => {
    const createdAt = new Date("2026-10-20T08:00:00.000Z");
    const open = await prisma.withdrawal.create({
      data: { userId, amount: 500_000, method: "UPI", status: "HELD", upiId: "asha@okaxis", createdAt, holdUntil: new Date("2026-10-21T20:00:00.000Z"), cancelableUntil: new Date("2026-10-20T20:00:00.000Z") },
    });
    const legacy = await prisma.withdrawal.create({
      data: { userId, amount: 600_000, method: "UPI", status: "HELD", upiId: "asha@okaxis", createdAt: new Date("2026-10-19T08:00:00.000Z"), holdUntil: new Date("2026-10-21T08:00:00.000Z") },
    });
    const res = await GET(
      new NextRequest("http://localhost/api/v1/withdrawal-prefill", { headers: { authorization: `Bearer ${token}` } }),
    );
    const held = WithdrawalPrefillSchema.parse(await res.json()).heldWithdrawals;
    expect(held.find((w) => w.id === open.id)).toEqual({
      id: open.id,
      amountMinor: 500_000,
      createdAt: createdAt.toISOString(),
      cancelableUntil: "2026-10-20T20:00:00.000Z",
    });
    expect(held.find((w) => w.id === legacy.id)?.cancelableUntil).toBeNull();
  });
});
