import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { inviteExtraBonusPreviewPct } from "./referral-qualification";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

async function user(tag: string, referredById?: string) {
  const u = await prisma.user.create({
    data: { email: `${tag}-${randomUUID()}-${RUN}@test.local`, passwordHash: "x", ...(referredById ? { referredById } : {}) },
  });
  const live = await prisma.account.create({ data: { userId: u.id, type: "LIVE", currency: "INR" } });
  return { u, live };
}

describe("invite extra bonus preview", () => {
  it("is the configured extra for an invited friend before the first deposit, 0 otherwise", async () => {
    const inviter = await user("inviter");
    const friend = await user("friend", inviter.u.id);
    expect(await inviteExtraBonusPreviewPct(friend.u.id)).toBe(10);
    expect(await inviteExtraBonusPreviewPct(inviter.u.id)).toBe(0);

    // Withheld while a self-referral flag stands, like the credit itself.
    const flag = await prisma.fraudFlag.create({
      data: { userId: friend.u.id, kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: [friend.u.id, inviter.u.id], evidence: {} },
    });
    expect(await inviteExtraBonusPreviewPct(friend.u.id)).toBe(0);
    await prisma.fraudFlag.update({ where: { id: flag.id }, data: { status: "DISMISSED" } });

    // Gone once a deposit has been credited.
    await prisma.transaction.create({
      data: { accountId: friend.live.id, kind: "DEPOSIT", amount: 50_000, balanceAfter: 50_000, refType: "Deposit", refId: randomUUID() },
    });
    expect(await inviteExtraBonusPreviewPct(friend.u.id)).toBe(0);
  });
});
