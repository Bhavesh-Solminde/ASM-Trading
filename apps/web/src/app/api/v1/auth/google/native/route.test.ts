import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { readSession } from "@/lib/session";

const email = `gnative-${randomUUID()}@test.local`;
vi.mock("@/lib/google-native", async (orig) => {
  const real = await orig<typeof import("@/lib/google-native")>();
  const { GoogleSignInError } = await import("@/lib/google-oauth");
  return {
    ...real,
    verifyNativeIdToken: vi.fn(async (token: string) => {
      if (token !== "good-token-xxxxxxxxxxxxxxxx") throw new GoogleSignInError("invalid id_token");
      return { sub: `sub-${email}`, email, givenName: "Asha", familyName: null };
    }),
  };
});
vi.mock("@asm/mail", () => ({ sendWelcomeEmail: vi.fn(async () => {}) }));

const { POST } = await import("./route");
const saved = { android: process.env["GOOGLE_ANDROID_CLIENT_IDS"], web: process.env["GOOGLE_CLIENT_ID"] };

afterEach(() => {
  for (const [k, v] of [["GOOGLE_ANDROID_CLIENT_IDS", saved.android], ["GOOGLE_CLIENT_ID", saved.web]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  await redis.quit();
});

const call = (idToken: string) =>
  POST(
    new NextRequest("http://localhost/api/v1/auth/google/native", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID(), "x-client": "app/1.0.0" },
      body: JSON.stringify({ idToken }),
    }),
  );

describe("POST /api/v1/auth/google/native", () => {
  it("is unavailable when no Google client ids are configured", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "";
    delete process.env["GOOGLE_CLIENT_ID"];
    expect((await call("good-token-xxxxxxxxxxxxxxxx")).status).toBe(503);
  });

  it("refuses an invalid token", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "android-id";
    const res = await call("bad-token-xxxxxxxxxxxxxxxxx");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("google_failed");
  });

  it("creates the account once, then signs the same person in", async () => {
    process.env["GOOGLE_ANDROID_CLIENT_IDS"] = "android-id";
    const first = (await (await call("good-token-xxxxxxxxxxxxxxxx")).json()) as { token: string; userId: string; created: boolean };
    expect(first.created).toBe(true);
    expect((await readSession(first.token))?.client).toBe("APP");
    const second = (await (await call("good-token-xxxxxxxxxxxxxxxx")).json()) as { userId: string; created: boolean };
    expect(second).toMatchObject({ userId: first.userId, created: false });
  });
});
