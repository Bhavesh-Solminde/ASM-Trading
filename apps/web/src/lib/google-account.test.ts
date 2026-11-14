import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ensureReferralCode, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";

vi.mock("@asm/mail", async (orig) => ({ ...(await orig<typeof import("@asm/mail")>()), sendWelcomeEmail: vi.fn(async () => {}) }));

const { signInWithGoogleProfile } = await import("./google-account");

const RUN = randomUUID();
const log = childLogger("test");
const ctx = () => ({ cid: "test", ip: randomUUID(), userAgent: "vitest" });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

describe("signInWithGoogleProfile referral", () => {
  it("attaches the invitation cookie code to a newly created user only", async () => {
    const inviter = await prisma.user.create({ data: { email: `ginv-${RUN}@test.local`, passwordHash: "x" } });
    const code = await ensureReferralCode(inviter.id);
    const email = `gnew-${RUN}@test.local`;
    const profile = { sub: `sub-${RUN}`, email, givenName: "Asha", familyName: null };

    const first = await signInWithGoogleProfile(profile, ctx(), log, code);
    expect(first.created).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: first.userId } });
    expect(row).toMatchObject({ referredById: inviter.id, referralVia: "LINK" });

    // A returning sign-in with another inviter's cookie changes nothing.
    const other = await prisma.user.create({ data: { email: `ginv2-${RUN}@test.local`, passwordHash: "x" } });
    const again = await signInWithGoogleProfile(profile, ctx(), log, await ensureReferralCode(other.id));
    expect(again.created).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).referredById).toBe(inviter.id);
  });

  it("still signs up when the cookie code is invalid", async () => {
    const email = `gbad-${RUN}@test.local`;
    const res = await signInWithGoogleProfile({ sub: `sub2-${RUN}`, email, givenName: null, familyName: null }, ctx(), log, "ZZZZZZZZ");
    expect(res.created).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: res.userId } })).referredById).toBeNull();
  });
});
