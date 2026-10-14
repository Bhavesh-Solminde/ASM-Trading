import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@asm/db";
import { createSession, readSession } from "./session";
import { APP_SESSION_TTL_MS, SESSION_TTL_MS } from "./session-cookie";

const DAY = 24 * 60 * 60 * 1000;
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `session-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

function rowFor(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return prisma.session.findUniqueOrThrow({ where: { tokenHash } });
}

describe("createSession", () => {
  it("gives a web session the 7-day lifetime by default", async () => {
    const row = await rowFor(await createSession(userId, {}));
    expect(row.client).toBe("WEB");
    expect(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - SESSION_TTL_MS)).toBeLessThan(5_000);
  });

  it("gives an app session the 30-day lifetime and records the device name", async () => {
    const row = await rowFor(await createSession(userId, { client: "APP", deviceName: "Redmi Note 13" }));
    expect(row.client).toBe("APP");
    expect(row.deviceName).toBe("Redmi Note 13");
    expect(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - APP_SESSION_TTL_MS)).toBeLessThan(5_000);
  });
});

describe("readSession", () => {
  it("reports the client of the session", async () => {
    expect((await readSession(await createSession(userId, { client: "APP" })))?.client).toBe("APP");
  });

  it("rolls an app session forward to 30 days once it has less than 29 days left", async () => {
    const token = await createSession(userId, { client: "APP" });
    const row = await rowFor(token);
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 28 * DAY) } });
    expect((await readSession(token))?.refreshed).toBe(true);
    expect((await rowFor(token)).expiresAt.getTime()).toBeGreaterThan(Date.now() + 29.9 * DAY);
  });

  it("leaves an app session alone while it has more than 29 days left", async () => {
    expect((await readSession(await createSession(userId, { client: "APP" })))?.refreshed).toBe(false);
  });

  it("rejects and deletes an expired app session", async () => {
    const token = await createSession(userId, { client: "APP" });
    const row = await rowFor(token);
    await prisma.session.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: row.id } })).toBeNull();
  });
});
