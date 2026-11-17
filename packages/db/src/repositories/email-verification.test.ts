import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { consumeEmailVerificationToken, issueEmailVerificationToken } from "./email-verification";
import { findUserByEmail } from "./user";

const RUN = randomUUID();
let userId = "";

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `ev-${RUN}@test.local`, passwordHash: "x", role: "AFFILIATE" } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

const verified = async () => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified;

describe("email verification tokens", () => {
  it("stores only the hash and works exactly once", async () => {
    const { id, token } = await issueEmailVerificationToken(userId);
    const row = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(23 * 3_600_000);
    expect(await verified()).toBe(false);
    expect(await consumeEmailVerificationToken(token)).toEqual({ userId });
    expect(await verified()).toBe(true);
    expect(await consumeEmailVerificationToken(token)).toBeNull();
  });

  it("rejects unknown and expired tokens and kills older ones on reissue", async () => {
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: false } });
    expect(await consumeEmailVerificationToken("nope")).toBeNull();

    const expired = await issueEmailVerificationToken(userId);
    await prisma.emailVerificationToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await consumeEmailVerificationToken(expired.token)).toBeNull();

    const older = await issueEmailVerificationToken(userId);
    const newer = await issueEmailVerificationToken(userId);
    expect(await consumeEmailVerificationToken(older.token)).toBeNull();
    expect(await verified()).toBe(false);
    expect(await consumeEmailVerificationToken(newer.token)).toEqual({ userId });
  });
});

describe("findUserByEmail portals", () => {
  it("scopes each portal to its own rows and hides legacy simulated affiliates", async () => {
    const email = `portal-${RUN}@test.local`;
    const user = await prisma.user.create({ data: { email, passwordHash: "x" } });
    await prisma.user.create({ data: { email, passwordHash: "x", role: "AFFILIATE", legacySimulated: true, status: "BANNED" } });
    expect((await findUserByEmail(email.toUpperCase()))?.id).toBe(user.id);
    expect(await findUserByEmail(email, "affiliate")).toBeNull();

    const aff = await prisma.user.create({ data: { email, passwordHash: "x", role: "AFFILIATE" } });
    expect((await findUserByEmail(email, "affiliate"))?.id).toBe(aff.id);
    expect((await findUserByEmail(email, "main"))?.id).toBe(user.id);
  });

  it("returns null when a USER and an ADMIN share an email", async () => {
    const email = `dual-${RUN}@test.local`;
    await prisma.user.create({ data: { email, passwordHash: "x" } });
    await prisma.user.create({ data: { email, passwordHash: "x", role: "ADMIN" } });
    expect(await findUserByEmail(email)).toBeNull();
  });
});
