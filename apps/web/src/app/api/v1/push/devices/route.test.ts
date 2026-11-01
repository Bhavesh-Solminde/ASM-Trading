import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession } from "@/lib/session";
import { DELETE, POST } from "./route";

let userId = "";
let token = "";
const fcmToken = `fcm-${randomUUID()}-${"x".repeat(40)}`;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `dev-${randomUUID()}@test.local`, passwordHash: "x", locale: "hi" } });
  userId = user.id;
  token = await createSession(userId, { client: "APP" });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

const call = (fn: typeof POST, body: unknown, method: string) =>
  fn(new NextRequest("http://localhost/api/v1/push/devices", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("/api/v1/push/devices", () => {
  it("registers an Android device in the user's language", async () => {
    expect((await call(POST, { platform: "ANDROID", token: fcmToken }, "POST")).status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: fcmToken } })).toMatchObject({ userId, locale: "hi" });
  });
  it("rejects a web push subscription without keys", async () => {
    expect((await call(POST, { platform: "WEBPUSH", token: "https://push.example/x" }, "POST")).status).toBe(400);
  });
  it("removes the caller's device", async () => {
    expect((await call(DELETE, { token: fcmToken }, "DELETE")).status).toBe(204);
    expect(await prisma.pushDevice.findUnique({ where: { token: fcmToken } })).toBeNull();
  });
});
