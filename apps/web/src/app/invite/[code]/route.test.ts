import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { ensureReferralCode, prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { GET } from "./route";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

function open(code: string, cookie?: string) {
  const req = new NextRequest(`http://localhost/invite/${code}`, {
    headers: { "x-forwarded-for": randomUUID(), ...(cookie && { cookie }) },
  });
  return GET(req, { params: Promise.resolve({ code }) });
}

describe("GET /invite/[code]", () => {
  it("sets asm_ref to the normalised code and 303s to /register", async () => {
    const u = await prisma.user.create({ data: { email: `invite-${RUN}@test.local`, passwordHash: "x" } });
    const code = await ensureReferralCode(u.id);
    const res = await open(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`, "asm_ref=OLDCODE2");
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/register");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`asm_ref=${code}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("leaves an existing cookie untouched for an invalid code", async () => {
    for (const code of ["ZZZZZZZZ", "not a code", "%2F%2Fevil.example"]) {
      const res = await open(code, "asm_ref=ABCDEFGH");
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/register");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
