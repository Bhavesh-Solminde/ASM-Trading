import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn<
    (input: { to: string; userId: string; name: string; firstDepositBonusPercent: number }) => Promise<{ ok: true; id: string }>
  >(async () => ({ ok: true, id: "em" })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { POST } from "./route";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => mail.sendWelcomeEmail.mockClear());

function register(email: string) {
  return POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID() },
      body: JSON.stringify({ name: "Asha Rao", email, password: "correct-horse-battery" }),
    }),
  );
}

describe("register welcome email", () => {
  it("welcomes a new account by first name with the first-deposit bonus", async () => {
    const email = `welcome-${RUN}@test.local`;
    const res = await register(email);
    expect(res.status).toBe(201);
    const { userId } = (await res.json()) as { userId: string };
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, userId, name: "Asha", firstDepositBonusPercent: 100 }),
    );
  });

  it("sends nothing when the email is already registered", async () => {
    const email = `dupe-${RUN}@test.local`;
    await register(email);
    mail.sendWelcomeEmail.mockClear();
    expect((await register(email)).status).toBe(409);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
