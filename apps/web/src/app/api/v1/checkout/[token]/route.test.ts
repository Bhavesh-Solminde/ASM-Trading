import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckoutViewSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let ownerId = "";
let strangerId = "";
let ownerToken = "";
let strangerToken = "";
const checkoutToken = randomUUID();

beforeAll(async () => {
  const [owner, stranger] = await Promise.all([
    prisma.user.create({ data: { email: `co-a-${randomUUID()}@test.local`, passwordHash: "x" } }),
    prisma.user.create({ data: { email: `co-b-${randomUUID()}@test.local`, passwordHash: "x" } }),
  ]);
  ownerId = owner.id;
  strangerId = stranger.id;
  ownerToken = await createSession(ownerId, { client: "APP" });
  strangerToken = await createSession(strangerId, { client: "APP" });
  await prisma.deposit.create({
    data: {
      userId: ownerId,
      method: "PhonePe",
      amountUsd: 1200,
      amountInr: 100_000,
      vpa: "collect@ybl",
      checkoutToken,
      correlationId: randomUUID(),
      expiresAt: new Date(Date.now() + 300_000),
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  await prisma.$disconnect();
});

const get = (bearer: string) =>
  GET(new NextRequest(`http://localhost/api/v1/checkout/${checkoutToken}`, { headers: { authorization: `Bearer ${bearer}` } }), {
    params: Promise.resolve({ token: checkoutToken }),
  });

describe("GET /api/v1/checkout/:token", () => {
  it("returns the pay details, including the upi link, to the deposit's owner", async () => {
    const res = await get(ownerToken);
    expect(res.status).toBe(200);
    const view = CheckoutViewSchema.parse(await res.json());
    expect(view.upiUri).toMatch(/^upi:\/\/pay\?pa=collect%40ybl/);
    expect(view.status).toBe("AWAITING_PAYMENT");
  });

  it("hides someone else's deposit as not found", async () => {
    expect((await get(strangerToken)).status).toBe(404);
  });
});
