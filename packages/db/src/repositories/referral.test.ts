import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import {
  attachReferralAtSignup,
  ensureReferralCode,
  getReferralSummaryForAdmin,
  normaliseReferralCode,
  resolveInvitationCode,
} from "./referral";

const RUN = randomUUID();
let n = 0;

afterAll(async () => {
  // Flags cascade with their user; referredById is SET NULL so delete order doesn't matter.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function user(data: Partial<Prisma.UserCreateInput> = {}) {
  return prisma.user.create({
    data: { email: `ref-${n++}-${RUN}@test.local`, passwordHash: "x", ...data },
  });
}

async function inviter(data: Partial<Prisma.UserCreateInput> = {}) {
  const u = await user(data);
  return { ...u, code: await ensureReferralCode(u.id) };
}

const attach = (userId: string, code: string, extra: { ip?: string; userAgent?: string; deviceFp?: string } = {}) =>
  attachReferralAtSignup({ userId, code, via: "LINK", ip: randomUUID(), userAgent: "ua-invitee", ...extra });

describe("referral codes", () => {
  it("normalises input and rejects impossible shapes", () => {
    expect(normaliseReferralCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normaliseReferralCode("ab cd 23 45")).toBe("ABCD2345");
    expect(normaliseReferralCode("ABCDEFG")).toBeNull();
    expect(normaliseReferralCode("ABCDEFGO")).toBeNull(); // O is not in the alphabet
    expect(normaliseReferralCode("ABCDEFG1")).toBeNull();
    expect(normaliseReferralCode("")).toBeNull();
  });

  it("assigns an 8-character code once, stable across calls, unique per user", async () => {
    const a = await user();
    const b = await user();
    const code = await ensureReferralCode(a.id);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(await ensureReferralCode(a.id)).toBe(code);
    const [c1, c2] = await Promise.all([ensureReferralCode(b.id), ensureReferralCode(b.id)]);
    expect(c1).toBe(c2);
    expect(c1).not.toBe(code);
  });

  it("resolves USER and live AFFILIATE codes, case/hyphen-insensitively", async () => {
    const u = await inviter();
    const aff = await inviter({ role: "AFFILIATE" });
    const flagged = await inviter({ status: "FLAGGED" });
    expect(await resolveInvitationCode(`${u.code.slice(0, 4).toLowerCase()}-${u.code.slice(4)}`)).toEqual({ inviterId: u.id });
    expect(await resolveInvitationCode(aff.code)).toEqual({ inviterId: aff.id });
    expect(await resolveInvitationCode(flagged.code)).toEqual({ inviterId: flagged.id });
  });

  it("rejects ADMIN, legacy simulated, BANNED and FROZEN inviters", async () => {
    for (const data of [
      { role: "ADMIN" as const },
      { role: "AFFILIATE" as const, legacySimulated: true },
      { status: "BANNED" as const },
      { status: "FROZEN" as const },
    ]) {
      const inv = await inviter(data);
      expect(await resolveInvitationCode(inv.code)).toBeNull();
    }
    expect(await resolveInvitationCode("ZZZZZZZZ")).toBeNull();
  });
});

describe("attachReferralAtSignup", () => {
  it("attaches once and never replaces the inviter", async () => {
    const a = await inviter();
    const b = await inviter();
    const invitee = await user();
    expect(await attach(invitee.id, a.code)).toEqual({ outcome: "attached", flagged: false });
    expect(await attach(invitee.id, b.code)).toEqual({ outcome: "already", flagged: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(row).toMatchObject({ referredById: a.id, referralVia: "LINK" });
    expect(row.referredAt).toBeInstanceOf(Date);
  });

  it("is race-safe: concurrent attaches record exactly one inviter", async () => {
    const a = await inviter();
    const b = await inviter();
    const invitee = await user();
    const results = await Promise.all([attach(invitee.id, a.code), attach(invitee.id, b.code)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["already", "attached"]);
  });

  it("can't claim an existing (not just created) user", async () => {
    const a = await inviter();
    const old = await user({ createdAt: new Date(Date.now() - 24 * 3600 * 1000) });
    expect((await attach(old.id, a.code)).outcome).toBe("already");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).referredById).toBeNull();
  });

  it("returns invalid for an unknown or ineligible code", async () => {
    const invitee = await user();
    const banned = await inviter({ status: "BANNED" });
    expect((await attach(invitee.id, "ZZZZZZZZ")).outcome).toBe("invalid");
    expect((await attach(invitee.id, banned.code)).outcome).toBe("invalid");
  });

  it("refuses the person's own code, in both user↔affiliate directions", async () => {
    const email = `same-${RUN}@test.local`;
    const u = await inviter({ email });
    const aff = await inviter({ email: email.toUpperCase(), role: "AFFILIATE" });
    expect((await attach(aff.id, u.code)).outcome).toBe("self");
    expect((await attach(u.id, aff.code)).outcome).toBe("self");
    expect((await attach(u.id, u.code)).outcome).toBe("self");
  });

  it("keeps the referral but opens a SELF_REFERRAL flag on a shared IP", async () => {
    const ip = `10.${RUN}`;
    const a = await inviter({ signupIp: ip, signupUserAgent: "ua-shared" });
    const invitee = await user();
    expect(await attach(invitee.id, a.code, { ip, userAgent: "ua-shared" })).toEqual({ outcome: "attached", flagged: true });
    const flags = await prisma.fraudFlag.findMany({ where: { userId: invitee.id } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: [invitee.id, a.id] });
    expect(flags[0]!.evidence).toMatchObject({ sharedIps: [ip], sharedUserAgents: ["ua-shared"], sharedDeviceFps: [] });

    const summary = await getReferralSummaryForAdmin(invitee.id);
    expect(summary).toMatchObject({ referredBy: { id: a.id, email: a.email, role: "USER" }, via: "LINK", code: null, selfReferralFlags: 1 });
    expect((await getReferralSummaryForAdmin(a.id))?.selfReferralFlags).toBe(1);
  });

  it("flags a shared device fingerprint and the inviter's last IP", async () => {
    const lastIp = `10.last.${RUN}`;
    const a = await inviter({ lastIp, signupDeviceFp: `fp-${RUN}` });
    const i1 = await user();
    const i2 = await user();
    expect((await attach(i1.id, a.code, { deviceFp: `fp-${RUN}` })).flagged).toBe(true);
    expect((await attach(i2.id, a.code, { ip: lastIp })).flagged).toBe(true);
  });

  it("does not flag placeholder IP/UA values", async () => {
    const a = await inviter({ signupIp: "local", signupUserAgent: "unknown" });
    const invitee = await user();
    expect(await attach(invitee.id, a.code, { ip: "local", userAgent: "unknown" })).toEqual({ outcome: "attached", flagged: false });
  });
});
