import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { GoogleAccountConflict, findOrCreateGoogleUser } from "./user";

const created: string[] = [];

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created.splice(0) } } });
});

function identity(email = `g-${randomUUID()}@test.local`) {
  return { sub: `sub-${randomUUID()}`, email, firstName: "Asha", lastName: "Rao", passwordHash: "unusable" };
}

describe("findOrCreateGoogleUser", () => {
  it("creates a verified user with the Google id and name on first sign-in", async () => {
    const id = identity();
    const result = await findOrCreateGoogleUser(id);
    created.push(result.userId);
    expect(result.created).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user).toMatchObject({ email: id.email, googleSub: id.sub, emailVerified: true, firstName: "Asha", role: "USER" });
  });

  it("returns the same user on the next sign-in, by Google id", async () => {
    const id = identity();
    const first = await findOrCreateGoogleUser(id);
    created.push(first.userId);
    const again = await findOrCreateGoogleUser({ ...id, email: `changed-${id.email}` });
    expect(again).toEqual({ userId: first.userId, created: false });
  });

  it("links Google to an existing email/password account instead of creating a second one", async () => {
    const id = identity();
    const existing = await prisma.user.create({ data: { email: id.email, passwordHash: "real-hash" } });
    created.push(existing.id);
    const result = await findOrCreateGoogleUser({ ...id, email: id.email.toUpperCase() });
    expect(result).toEqual({ userId: existing.id, created: false });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(user.googleSub).toBe(id.sub);
    expect(user.emailVerified).toBe(true);
    expect(user.passwordHash).toBe("real-hash"); // password login keeps working
  });

  it("refuses an email already linked to a different Google account", async () => {
    const id = identity();
    const first = await findOrCreateGoogleUser(id);
    created.push(first.userId);
    await expect(findOrCreateGoogleUser({ ...id, sub: "someone-else" })).rejects.toBeInstanceOf(GoogleAccountConflict);
  });
});
