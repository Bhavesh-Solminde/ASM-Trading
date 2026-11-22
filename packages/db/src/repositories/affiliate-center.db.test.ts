import { randomUUID } from "node:crypto";
import { USD_INR_RATE } from "@asm/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import {
  createAffiliateLink,
  getAffiliateLevelStatus,
  getAffiliateSeries,
  getAffiliateStatsBy,
  getAffiliateTotals,
  listAffiliateLinks,
  listAffiliateTraders,
  listLevelTerms,
} from "./affiliate-center";
import { recordAffiliateLinkClick } from "./affiliate-links";
import { programSettingValueAt } from "./program-settings";
import { istDayStart } from "./program-wallet";

const RUN = randomUUID();
let n = 0;

async function user(data: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  return prisma.user.create({ data: { email: `center-${n++}-${RUN}@test.local`, passwordHash: "x", ...data } });
}

async function friend(affiliateId: string, at: Date, details: { currency?: string; country?: string; linkId?: string } = {}) {
  const row = await user({ referredById: affiliateId, referralLinkId: details.linkId ?? null, createdAt: at, country: details.country ?? null });
  const account = await prisma.account.create({ data: { userId: row.id, type: "LIVE", currency: details.currency ?? "INR" } });
  return { ...row, account };
}

async function credit(trader: Awaited<ReturnType<typeof friend>>, at: Date, creditMinor: number, status: "COMPLETED" | "REJECTED" = "COMPLETED") {
  const usd = trader.account.currency === "USD";
  const deposit = await prisma.deposit.create({
    data: {
      userId: trader.id, method: "upi", amountInr: usd ? creditMinor * USD_INR_RATE : creditMinor,
      amountUsd: usd ? creditMinor : Math.round(creditMinor / USD_INR_RATE), vpa: "test@upi", status,
      checkoutToken: randomUUID(), correlationId: RUN, createdAt: at, updatedAt: at, expiresAt: at,
    },
  });
  await prisma.transaction.create({
    data: { accountId: trader.account.id, kind: "DEPOSIT", refType: "Deposit", refId: deposit.id, amount: creditMinor, balanceAfter: creditMinor, createdAt: at },
  });
  return deposit;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

describe("frozen affiliate levels", () => {
  it("uses the first LIVE credit, its deposit threshold, and the IST calendar boundary", async () => {
    const at = istDayStart("2038-02-01");
    const before = new Date(at.getTime() - 1);
    const joined = istDayStart("2038-01-01");
    const minimum = (await programSettingValueAt("MIN_QUALIFYING_DEPOSIT_INR_MINOR", at))!;
    const affiliate = await user({ role: "AFFILIATE", createdAt: joined });
    const qualified = await Promise.all(Array.from({ length: 14 }, async () => credit(await friend(affiliate.id, joined), before, minimum)));
    const flagged = await friend(affiliate.id, joined);
    await credit(flagged, before, minimum);
    await prisma.fraudFlag.create({ data: { userId: affiliate.id, kind: "SELF_REFERRAL", status: "CONFIRMED", linkedUserIds: [flagged.id], evidence: {} } });

    const reversed = await friend(affiliate.id, joined);
    await credit(reversed, new Date(before.getTime() - 5), minimum, "REJECTED");
    await credit(reversed, before, minimum);
    const small = await friend(affiliate.id, joined);
    await credit(small, new Date(before.getTime() - 5), minimum - 1);
    await credit(small, before, minimum);

    expect(await getAffiliateLevelStatus(affiliate.id, before)).toMatchObject({
      current: { level: 1 }, next: { level: 1 }, monthQualifyingDeposits: 14, toKeep: 0, toNextLevel: 1,
    });

    await credit(await friend(affiliate.id, joined), before, minimum);
    await credit(await friend(affiliate.id, joined), at, minimum);
    const outcomes = await Promise.all([getAffiliateLevelStatus(affiliate.id, at), getAffiliateLevelStatus(affiliate.id, at)]);
    expect(outcomes[0]).toMatchObject({
      current: { level: 2 }, next: { level: 1 }, monthQualifyingDeposits: 1, toKeep: 14, toNextLevel: 49,
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
    const snapshot = await prisma.affiliateMonthLevel.findUniqueOrThrow({
      where: { affiliateId_month: { affiliateId: affiliate.id, month: new Date("2038-02-01T00:00:00.000Z") } },
    });
    expect(snapshot.qualifyingDeposits).toBe(15);
    await prisma.deposit.update({ where: { id: qualified[0]!.id }, data: { status: "REJECTED" } });
    expect(await getAffiliateLevelStatus(affiliate.id, at)).toEqual(outcomes[0]);
    expect((await getAffiliateLevelStatus(affiliate.id, istDayStart("2038-03-01"))).current.level).toBe(1);
    const terms = await listLevelTerms(at);
    expect(terms).toHaveLength(7);
    expect(terms[0]).toHaveProperty("revenueShareBps");
    expect(terms[0]).not.toHaveProperty("depositRewardBps");
  });
});

describe("tracked links", () => {
  it("keeps a single default and enforces the limit even when creates race", async () => {
    const affiliate = await user({ role: "AFFILIATE" });
    const regular = await user();
    await expect(listAffiliateLinks(regular.id)).rejects.toMatchObject({ code: "not_found" });
    const [[first], [second]] = await Promise.all([listAffiliateLinks(affiliate.id), listAffiliateLinks(affiliate.id)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ isDefault: true, kind: "REGISTER", url: expect.stringMatching(/^\/invite\//) });

    await prisma.affiliateLink.createMany({
      data: Array.from({ length: 48 }, () => ({ affiliateId: affiliate.id, code: randomUUID(), kind: "APP" })),
    });
    const outcomes = await Promise.allSettled([
      createAffiliateLink(affiliate.id, { kind: "HOME", comment: " Campaign " }),
      createAffiliateLink(affiliate.id, { kind: "REGISTER" }),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({ reason: { code: "link_limit" } });
    expect(await listAffiliateLinks(affiliate.id)).toHaveLength(50);
  });
});

describe("affiliate statistics", () => {
  it("uses independent event dates, ranges, currency conversion and scoped trader IDs", async () => {
    const from = istDayStart("2038-06-07");
    const to = istDayStart("2038-06-09");
    const nextDay = istDayStart("2038-06-08");
    const earlier = new Date(from.getTime() - 1);
    const affiliate = await user({ role: "AFFILIATE" });
    const [[base], home] = await Promise.all([listAffiliateLinks(affiliate.id), createAffiliateLink(affiliate.id, { kind: "HOME" })]);
    const trader = await friend(affiliate.id, from, { country: "IN", currency: "USD", linkId: home.id });
    const older = await friend(affiliate.id, earlier, { linkId: base!.id });
    await credit(older, earlier, 900);
    await credit(older, nextDay, 2_000);
    const firstDeposit = await credit(trader, from, 101);
    await credit(trader, to, 1000);
    await prisma.transaction.create({
      data: { accountId: trader.account.id, kind: "BONUS_GRANT", refType: "Deposit", refId: firstDeposit.id, amount: 40,
        balanceAfter: 141, createdAt: from },
    });
    await Promise.all([recordAffiliateLinkClick(home.id, from), recordAffiliateLinkClick(home.id, from), recordAffiliateLinkClick(home.id, to)]);

    const asset = await prisma.asset.findFirstOrThrow({ select: { id: true } });
    const trade = await prisma.trade.create({
      data: { accountId: trader.account.id, assetId: asset.id, direction: "UP", stake: 100, stakeFromBonus: 10,
        currency: "USD", status: "LOST", payoutPct: 80, entryPrice: 1, entryTs: earlier, expiryTs: from },
    });
    const withdrawal = await prisma.withdrawal.create({
      data: { userId: trader.id, amount: 50, currency: "USD", method: "UPI", status: "PAID", createdAt: earlier },
    });
    await prisma.auditLog.create({
      data: { actorId: null, action: "withdrawal.paid", targetType: "Withdrawal", targetId: withdrawal.id, createdAt: nextDay, after: {} },
    });
    const qualification = await prisma.referralQualification.create({
      data: {
        referredUserId: trader.id, inviterId: affiliate.id, firstDepositId: firstDeposit.id, qualifyingTradeId: trade.id,
        depositInrMinor: 101 * USD_INR_RATE, tradeRealStakeInrMinor: 90 * USD_INR_RATE,
        minDepositInrMinor: 101 * USD_INR_RATE, minTradeInrMinor: 90 * USD_INR_RATE, settingIds: [], qualifiedAt: from,
      },
    });
    await prisma.programEarning.createMany({
      data: [
        { beneficiaryUserId: affiliate.id, kind: "ADJUSTMENT", amountMinor: 30, status: "AVAILABLE", settingIds: [], earnedAt: from },
        { beneficiaryUserId: affiliate.id, kind: "ADJUSTMENT", amountMinor: 200, status: "VOID", settingIds: [], earnedAt: nextDay },
        { beneficiaryUserId: affiliate.id, kind: "AFFILIATE_DEPOSIT_REWARD", qualificationId: qualification.id, amountMinor: 17, status: "PENDING", settingIds: [], earnedAt: from },
      ],
    });
    const range = { from, to };
    const totals = await getAffiliateTotals(affiliate.id, range);
    expect(totals).toEqual({
      clicks: 2, registrations: 1, ftdCount: 1, ftdSumMinor: 101 * USD_INR_RATE,
      depositsCount: 2, depositsSumMinor: 101 * USD_INR_RATE + 2_000, withdrawalsCount: 1,
      withdrawalsSumMinor: 50 * USD_INR_RATE, turnoverMinor: 90 * USD_INR_RATE, earningsMinor: 47,
    });
    expect(await getAffiliateTotals(affiliate.id, range, { linkId: base!.id })).toMatchObject({ clicks: 0, depositsSumMinor: 2_000 });
    expect(await getAffiliateStatsBy(affiliate.id, "country", range)).toMatchObject([
      { key: "IN", withdrawalsCount: 1, ftdCount: 1, earningsMinor: 17, bonusesSumMinor: 40 * USD_INR_RATE },
      { key: "Unknown", depositsSumMinor: 2_000, earningsMinor: 30, bonusesSumMinor: 0 },
    ]);
    expect(await getAffiliateStatsBy(affiliate.id, "link", range, { linkId: home.id })).toMatchObject([
      { key: home.id, depositsCount: 1, earningsMinor: 17, bonusesSumMinor: 40 * USD_INR_RATE },
    ]);
    expect(await getAffiliateStatsBy(affiliate.id, "date", range)).toMatchObject([
      { key: "2038-06-08", depositsSumMinor: 2000 },
      { key: "2038-06-07", ftdCount: 1, clicks: 2 },
    ]);
    expect(await getAffiliateSeries(affiliate.id, range, "day")).toEqual([
      { start: from, clicks: 2, registrations: 1, ftdCount: 1 },
      { start: nextDay, clicks: 0, registrations: 0, ftdCount: 0 },
    ]);
    expect((await getAffiliateSeries(affiliate.id, range, "month"))[0]).toMatchObject({ start: istDayStart("2038-06-01"), clicks: 2 });
    expect((await getAffiliateSeries(affiliate.id, range, "week"))[0]).toMatchObject({ clicks: 2 });
    const page = await listAffiliateTraders(affiliate.id, range, { pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.rows).toEqual([{
      traderId: trader.id.slice(0, 8).toUpperCase(), registeredAt: from, linkId: home.id, country: "IN",
      ftdAt: from, ftdMinor: 101 * USD_INR_RATE, depositsCount: 1, depositsSumMinor: 101 * USD_INR_RATE,
      withdrawalsSumMinor: 50 * USD_INR_RATE, turnoverMinor: 90 * USD_INR_RATE, earningsMinor: 17,
    }]);
    expect(await listAffiliateTraders(affiliate.id, range, { traderId: trader.id.slice(0, 8), linkId: home.id })).toEqual({ ...page, total: 1 });
    expect(await listAffiliateTraders(affiliate.id, range, { page: 3, pageSize: 1 })).toEqual({ rows: [], total: 2 });
  });
});
