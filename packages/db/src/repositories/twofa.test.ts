import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { issueTwoFactorCode, verifyTwoFactorCode } from "./twofa";

let userId = "";
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `tf-${randomUUID()}@test.local`, passwordHash: "x" },
  });
  createdUserIds.push(user.id);
  return user.id;
}

beforeEach(async () => {
  userId = await makeUser();
});

afterEach(async () => {
  await prisma.twoFactorCode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("two-factor codes", () => {
  it("issues a six-digit code", async () => {
    expect(await issueTwoFactorCode(userId, "login")).toMatch(/^[0-9]{6}$/);
  });

  it("stores the code hashed, never in plain text", async () => {
    const code = await issueTwoFactorCode(userId, "login");
    const row = await prisma.twoFactorCode.findFirstOrThrow({ where: { userId } });
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash.length).toBeGreaterThan(20);
  });

  it("verifies a correct code", async () => {
    const code = await issueTwoFactorCode(userId, "login");
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(true);
  });

  it("rejects an incorrect code", async () => {
    await issueTwoFactorCode(userId, "login");
    expect(await verifyTwoFactorCode(userId, "login", "000000")).toBe(false);
  });

  it("is single-use — the same code cannot be replayed", async () => {
    const code = await issueTwoFactorCode(userId, "login");
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(true);
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("does not accept a code issued for another purpose", async () => {
    const code = await issueTwoFactorCode(userId, "withdrawal");
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("rejects an expired code", async () => {
    const code = await issueTwoFactorCode(userId, "login");
    await prisma.twoFactorCode.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("invalidates an earlier code when a new one is issued", async () => {
    const first = await issueTwoFactorCode(userId, "login");
    await issueTwoFactorCode(userId, "login");
    expect(await verifyTwoFactorCode(userId, "login", first)).toBe(false);
  });

  it("rejects a code for a different user", async () => {
    const code = await issueTwoFactorCode(userId, "login");
    const other = await makeUser();
    expect(await verifyTwoFactorCode(other, "login", code)).toBe(false);
  });
});
