import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WalletSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `wallet-${randomUUID()}@test.local`,
      passwordHash: "x",
      accounts: {
        create: [
          { type: "LIVE", realBalance: 150_000, bonusBalance: 50_000 },
          { type: "DEMO", realBalance: 1_000_000 },
        ],
      },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/v1/wallet", () => {
  it("refuses a signed-out caller", async () => {
    expect((await GET(new NextRequest("http://localhost/api/v1/wallet"))).status).toBe(401);
  });

  it("reports withdrawable money separately from locked bonus", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/wallet", { headers: { authorization: `Bearer ${token}` } }));
    const body = WalletSchema.parse(await res.json());
    expect(body.withdrawable).toBe(150_000);
    expect(body.lockedBonus).toBe(50_000);
    expect(body.completedDeposits).toBe(0);
    expect(body.nextBonusPercent).toBe(body.bonusTiers[0]);
  });
});
