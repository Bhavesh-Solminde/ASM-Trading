import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BootstrapSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `boot-${randomUUID()}@test.local`,
      passwordHash: "x",
      accounts: { create: [{ type: "DEMO", realBalance: 1_000_000 }, { type: "LIVE" }] },
    },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
  await redis.quit();
});

const get = (headers: Record<string, string>) =>
  GET(new NextRequest("http://localhost/api/v1/bootstrap", { headers: { "x-forwarded-for": "127.0.0.1", ...headers } }));

describe("GET /api/v1/bootstrap", () => {
  it("refuses a signed-out caller", async () => {
    expect((await get({})).status).toBe(401);
  });

  it("returns the trading shell data in the agreed shape", async () => {
    const res = await get({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = BootstrapSchema.parse(await res.json());
    expect(body.userId).toBe(userId);
    expect(body.accounts.map((a) => a.type).sort()).toEqual(["DEMO", "LIVE"]);
    expect(body.profile.locale).toBe("en");
  });
});
