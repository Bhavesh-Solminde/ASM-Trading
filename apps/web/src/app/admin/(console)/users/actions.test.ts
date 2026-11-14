import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "t" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "c", readAdminSession: async () => true }));

import { prisma } from "@asm/db";
import { updateUserAction } from "./actions";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

function form(userId: string, role: string): FormData {
  const f = new FormData();
  f.set("userId", userId);
  f.set("role", role);
  f.set("kycStatus", "NOT_STARTED");
  return f;
}

async function make(role: "USER" | "AFFILIATE") {
  return prisma.user.create({ data: { email: `role-${role}-${randomUUID()}-${RUN}@test.local`, passwordHash: "x", role } });
}

describe("admin role changes", () => {
  it("never converts a user into an affiliate", async () => {
    const u = await make("USER");
    await updateUserAction(form(u.id, "AFFILIATE"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("USER");
  });

  it("never converts an affiliate into a user or admin", async () => {
    const a = await make("AFFILIATE");
    await updateUserAction(form(a.id, "USER"));
    await updateUserAction(form(a.id, "ADMIN"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).role).toBe("AFFILIATE");
  });

  it("still allows user ↔ admin", async () => {
    const u = await make("USER");
    await updateUserAction(form(u.id, "ADMIN"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("ADMIN");
  });
});
