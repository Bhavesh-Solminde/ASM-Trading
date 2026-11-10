import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { GET } from "./route";

let userId = "";
let token = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `account-${randomUUID()}@test.local`, passwordHash: "x", nickname: "Asha" },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("GET /api/account", () => {
  it("answers an app bearer token with the caller's profile", async () => {
    const res = await GET(new NextRequest("http://localhost/api/account", { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile: { nickname: string | null } };
    expect(body.profile.nickname).toBe("Asha");
  });

  it("refuses a signed-out caller with the unauthenticated code", async () => {
    const res = await GET(new NextRequest("http://localhost/api/account"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthenticated");
  });
});
