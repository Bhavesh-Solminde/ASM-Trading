import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { PATCH } from "./route";

let userId = "";
let token = "";
beforeAll(async () => {
  // PENDING KYC locks profile edits — the language must still be changeable.
  const user = await prisma.user.create({
    data: { email: `pref-${randomUUID()}@test.local`, passwordHash: "x", kycStatus: "PENDING" },
  });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/v1/account/preferences", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("PATCH /api/v1/account/preferences", () => {
  it("switches the language even while KYC locks the profile", async () => {
    const res = await patch({ locale: "hi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "hi" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale).toBe("hi");
  });

  it("rejects an unsupported language", async () => {
    expect((await patch({ locale: "fr" })).status).toBe(400);
  });
});
