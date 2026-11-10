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
import { readSession } from "@/lib/session";
import { POST } from "./route";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => mail.sendWelcomeEmail.mockClear());

function register(email: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), ...headers },
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

describe("register session for the app", () => {
  it("returns an app session token in the body, without a cookie", async () => {
    const email = `reg-app-${RUN}@test.local`;
    const res = await register(email, { "x-client": "app/1.0.0", "x-device-name": "Pixel 8" });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as { token: string; userId: string };
    expect(typeof body.token).toBe("string");
    expect((await readSession(body.token))?.client).toBe("APP");
  });

  it("keeps the cookie response for the website", async () => {
    const res = await register(`reg-web-${RUN}@test.local`);
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=/);
    expect(Object.keys((await res.json()) as object)).toEqual(["userId"]);
  });
});
