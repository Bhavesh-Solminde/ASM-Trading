import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { createDepositIntent, creditDepositToAccount, reverseCompletedDeposit } from "./deposit";
import {
  evaluateReferralQualification,
  inviteExtraBonusPct,
  listUnqualifiedReferredUserIds,
  reverseQualificationForDeposit,
} from "./referral-qualification";

// Affiliate Program phase 4, doc §16 checks 1–7 at the domain level.
const RUN = randomUUID();
const SETTINGS_TAG = `test-${RUN}`;
let n = 0;
let assetId = "";

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ select: { id: true } })).id;
});

afterAll(async () => {
  // Accounts, trades, ledger, deposits, qualifications and earnings cascade with their user.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.programSetting.deleteMany({ where: { createdBy: SETTINGS_TAG } });
  await prisma.$disconnect();
});

async function makeUser(data: Partial<Prisma.UserCreateInput> = {}, currency = "INR") {
  const u = await prisma.user.create({ data: { email: `rq-${n++}-${RUN}@test.local`, passwordHash: "x", ...data } });
  await createAccountsForUser(u.id, 0, currency);
  // Phase 7: an affiliate earns PENDING (not HELD) only while ACTIVE.
  if (u.role === "AFFILIATE" && !u.legacySimulated) await prisma.affiliateProfile.create({ data: { userId: u.id, status: "ACTIVE" } });
  return u;
}

async function friendOf(inviterId: string, data: Partial<Prisma.UserCreateInput> = {}, currency = "INR") {
  return makeUser({ referredBy: { connect: { id: inviterId } }, referredAt: new Date(), referralVia: "LINK", ...data }, currency);
}

/** Creates and credits a UPI deposit of `inr` paise; returns its id. */
async function deposit(userId: string, inr: number, amountUsd = Math.round(inr / 100), requestedInrMinor: number | null = null) {
  const d = await prisma.deposit.create({
    data: {
      userId,
      method: "upi",
      amountInr: inr,
      amountUsd,
      requestedInrMinor,
      vpa: "test@upi",
      checkoutToken: randomUUID(),
      correlationId: RUN,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await creditDepositToAccount({ depositId: d.id, adminId: null });
  return d.id;
}

async function bonusOf(depositId: string) {
  const row = await prisma.transaction.findFirst({ where: { refType: "Deposit", refId: depositId, kind: "BONUS_GRANT" } });
  return row?.amount ?? 0;
}

async function trade(
  userId: string,
  opts: { stake?: number; fromBonus?: number; status?: "OPEN" | "WON" | "LOST" | "REFUNDED" | "CLOSED"; type?: "LIVE" | "DEMO"; at?: Date; mode?: "LEGACY_BINARY" | "CFD" | "OTC_FIXED" } = {},
) {
  const account = await prisma.account.findFirstOrThrow({ where: { userId, type: opts.type ?? "LIVE" } });
  const at = opts.at ?? new Date();
  const t = await prisma.trade.create({
    data: {
      accountId: account.id,
      assetId,
      mode: opts.mode ?? "LEGACY_BINARY",
      direction: "UP",
      stake: opts.stake ?? 10_000,
      stakeFromBonus: opts.fromBonus ?? 0,
      payoutPct: 80,
      entryPrice: 1,
      entryTs: new Date(at.getTime() - 60_000),
      expiryTs: at,
      status: opts.status ?? "LOST",
      ...(opts.mode === "CFD" ? { closedAt: at } : {}),
    },
  });
  return t.id;
}

const earningsOf = (beneficiaryUserId: string) => prisma.programEarning.findMany({ where: { beneficiaryUserId } });
const qualificationOf = (referredUserId: string) => prisma.referralQualification.findUnique({ where: { referredUserId } });

describe("regular inviter reward and friend bonus", () => {
  it("pays ₹50 once after both actions and gives the friend 110% on the first deposit", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" }); // signup only

    const dep = await deposit(friend.id, 50_000);
    expect(await bonusOf(dep)).toBe(55_000);
    const grant = await prisma.bonusGrant.findFirstOrThrow({ where: { account: { userId: friend.id } } });
    expect(grant).toMatchObject({ amount: 55_000, turnoverRequired: 165_000 });
    expect(await qualificationOf(friend.id)).toBeNull(); // deposit alone

    const tr = await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    const q = await qualificationOf(friend.id);
    expect(q).toMatchObject({ inviterId: inviter.id, firstDepositId: dep, qualifyingTradeId: tr, status: "QUALIFIED", depositInrMinor: 50_000, minDepositInrMinor: 50_000, minTradeInrMinor: 10_000 });
    expect(q!.settingIds).toHaveLength(5);
    const earnings = await earningsOf(inviter.id);
    expect(earnings).toHaveLength(1);
    expect(earnings[0]).toMatchObject({ kind: "REFERRAL_REWARD", amountMinor: 5_000, currency: "INR", status: "PENDING", holdReason: null });

    // Later deposits and trades never repeat the reward, and get no extra bonus.
    const dep2 = await deposit(friend.id, 100_000);
    expect(await bonusOf(dep2)).toBe(100_000);
    await trade(friend.id, { stake: 50_000 });
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "already" });
    expect(await earningsOf(inviter.id)).toHaveLength(1);
  });

  it("gives a non-invited user the ordinary 100% only", async () => {
    const u = await makeUser();
    const dep = await deposit(u.id, 50_000);
    expect(await bonusOf(dep)).toBe(50_000);
    expect(await evaluateReferralQualification(u.id)).toEqual({ outcome: "not_referred" });
  });

  it("is order independent: trade first, then the deposit qualifies on credit", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await trade(friend.id, { mode: "CFD", status: "CLOSED" });
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
    await deposit(friend.id, 60_000); // creditDepositToAccount evaluates after commit
    expect(await qualificationOf(friend.id)).not.toBeNull();
    expect(await earningsOf(inviter.id)).toHaveLength(1);
  });

  it("uses the first deposit that meets the minimum (₹200 then ₹600 → ₹600)", async () => {
    const inviter = await makeUser({ role: "AFFILIATE" });
    const friend = await friendOf(inviter.id);
    const small = await deposit(friend.id, 20_000);
    expect(await bonusOf(small)).toBe(22_000); // first deposit: 100% + 10%
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
    const big = await deposit(friend.id, 60_000);
    expect(await bonusOf(big)).toBe(60_000); // second deposit: no extra
    const q = await qualificationOf(friend.id);
    expect(q).toMatchObject({ firstDepositId: big, depositInrMinor: 60_000 });
    expect((await earningsOf(inviter.id))[0]).toMatchObject({ kind: "AFFILIATE_DEPOSIT_REWARD", amountMinor: 3_000 });
  });

  it("counts a USD-account trade at the platform FX rate ($1 real = ₹100)", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id, {}, "USD");
    await deposit(friend.id, 50_000, 500);
    await trade(friend.id, { stake: 100, mode: "OTC_FIXED", status: "WON" });
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    expect(await qualificationOf(friend.id)).toMatchObject({ tradeRealStakeInrMinor: 10_000 });
  });
});

describe("affiliate first-deposit reward", () => {
  it.each([
    [50_000, 2_500],
    [100_000, 5_000],
    [500_000, 25_000],
  ])("₹%i paise deposit → %i paise, no flat ₹50", async (amount, reward) => {
    const aff = await makeUser({ role: "AFFILIATE" });
    const friend = await friendOf(aff.id);
    const dep = await deposit(friend.id, amount);
    expect(await bonusOf(dep)).toBe(Math.floor((amount * 110) / 100));
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    const earnings = await earningsOf(aff.id);
    expect(earnings).toHaveLength(1);
    expect(earnings[0]).toMatchObject({ kind: "AFFILIATE_DEPOSIT_REWARD", amountMinor: reward, status: "PENDING" });
  });

  it("records a qualification but no earning for a legacy simulated affiliate inviter", async () => {
    const legacy = await makeUser({ role: "AFFILIATE", legacySimulated: true });
    const friend = await friendOf(legacy.id);
    await deposit(friend.id, 50_000);
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    expect(await earningsOf(legacy.id)).toHaveLength(0);
  });
});

describe("never qualifies", () => {
  it.each([
    ["demo-only trade", { type: "DEMO" as const }],
    ["open trade", { status: "OPEN" as const }],
    ["refunded trade", { status: "REFUNDED" as const }],
    ["bonus-funded stake (real part ₹50 < ₹100)", { stake: 15_000, fromBonus: 10_000 }],
  ])("%s", async (_label, opts) => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 50_000);
    await trade(friend.id, opts);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
    expect(await earningsOf(inviter.id)).toHaveLength(0);
  });

  it("a deposit below the minimum", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 49_999);
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
  });

  it("a legacy simulated or bot referred user", async () => {
    const inviter = await makeUser();
    for (const data of [{ legacySimulated: true }, { isBot: true }]) {
      const friend = await friendOf(inviter.id, data);
      await prisma.deposit.create({
        data: { userId: friend.id, method: "upi", amountInr: 50_000, amountUsd: 500, vpa: "x", checkoutToken: randomUUID(), correlationId: RUN, expiresAt: new Date(), status: "COMPLETED" },
      });
      await trade(friend.id);
      expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
    }
  });
});

describe("holds and races", () => {
  it("self-referral flag: no friend extra and the inviter's reward is HELD", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await prisma.fraudFlag.create({
      data: { userId: friend.id, kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: [friend.id, inviter.id], evidence: {} },
    });
    const dep = await deposit(friend.id, 50_000);
    expect(await bonusOf(dep)).toBe(50_000);
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    expect((await earningsOf(inviter.id))[0]).toMatchObject({ status: "HELD", holdReason: expect.stringMatching(/self-referral/) });
  });

  it("a FROZEN inviter's reward is HELD", async () => {
    const inviter = await makeUser({ status: "FROZEN" });
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 50_000);
    await trade(friend.id);
    await evaluateReferralQualification(friend.id);
    expect((await earningsOf(inviter.id))[0]).toMatchObject({ status: "HELD", holdReason: "inviter FROZEN" });
  });

  it("concurrent evaluations create exactly one qualification and one earning", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await trade(friend.id);
    // Seed a completed deposit without the credit hook so evaluation hasn't run yet.
    await prisma.deposit.create({
      data: { userId: friend.id, method: "upi", amountInr: 50_000, amountUsd: 500, vpa: "x", checkoutToken: randomUUID(), correlationId: RUN, expiresAt: new Date(), status: "COMPLETED" },
    });
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => evaluateReferralQualification(friend.id)));
    expect(outcomes.filter((o) => o.outcome === "qualified")).toHaveLength(1);
    expect(outcomes.every((o) => o.outcome === "qualified" || o.outcome === "already")).toBe(true);
    expect(await earningsOf(inviter.id)).toHaveLength(1);
  });

  it("the sweep lists unqualified candidates and pages by id", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 20_000);
    await trade(friend.id);
    const all: string[] = [];
    for (let after: string | undefined; ; ) {
      const page = await listUnqualifiedReferredUserIds(500, after);
      all.push(...page);
      if (page.length < 500) break;
      after = page[page.length - 1];
    }
    expect(all).toContain(friend.id);
    await deposit(friend.id, 50_000);
    expect(await listUnqualifiedReferredUserIds(1000, friend.id.slice(0, -1))).not.toContain(friend.id);
  });
});

describe("settings versions and corrections", () => {
  it("snapshots the reward in force when the second condition was met; later changes don't alter it", async () => {
    const at = (iso: string) => new Date(iso);
    const add = (value: number, effectiveFrom: string) =>
      prisma.programSetting.create({
        data: { key: "USER_REFERRAL_REWARD_INR_MINOR", value, effectiveFrom: at(effectiveFrom), createdBy: SETTINGS_TAG, reason: "test" },
      });
    const v1 = await add(7_000, "2900-01-01T00:00:00Z");
    const inviter = await makeUser();
    const a = await friendOf(inviter.id);
    await deposit(a.id, 50_000);
    await trade(a.id, { at: at("2900-02-01T00:00:00Z") });
    expect(await evaluateReferralQualification(a.id, at("2900-03-01T00:00:00Z"))).toEqual({ outcome: "qualified" });
    await add(9_000, "2900-04-01T00:00:00Z");
    expect(await evaluateReferralQualification(a.id, at("2900-05-01T00:00:00Z"))).toEqual({ outcome: "already" });
    const [earning] = await earningsOf(inviter.id);
    expect(earning).toMatchObject({ amountMinor: 7_000 });
    expect(earning!.settingIds).toContain(v1.id);

    const b = await friendOf(inviter.id);
    await deposit(b.id, 50_000);
    await trade(b.id, { at: at("2900-05-01T00:00:00Z") });
    await evaluateReferralQualification(b.id, at("2900-06-01T00:00:00Z"));
    expect((await earningsOf(inviter.id)).map((e) => e.amountMinor).sort()).toEqual([7_000, 9_000]);
  });

  it("reversing the qualifying deposit voids a pending earning and marks the qualification REVERSED", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await trade(friend.id);
    const dep = await deposit(friend.id, 50_000);
    expect(await qualificationOf(friend.id)).not.toBeNull();

    await reverseCompletedDeposit({ depositId: dep, adminId: "admin-test", reason: "chargeback" });
    expect(await qualificationOf(friend.id)).toMatchObject({ status: "REVERSED", reversedReason: expect.stringMatching(/chargeback/) });
    expect((await earningsOf(inviter.id))[0]).toMatchObject({ status: "VOID", voidReason: expect.stringMatching(/chargeback/) });
    // The extra friend bonus went back with the bonus grant.
    const live = await prisma.account.findFirstOrThrow({ where: { userId: friend.id, type: "LIVE" } });
    expect(live).toMatchObject({ realBalance: 0, bonusBalance: 0 });
    // A reversed qualification stays reversed.
    await deposit(friend.id, 50_000);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "already" });
    expect(await earningsOf(inviter.id)).toHaveLength(1);
  });
});

describe("review follow-ups", () => {
  it("§14: lowering a threshold never qualifies past activity; new qualifying evidence after the change does", async () => {
    await prisma.programSetting.create({
      data: { key: "MIN_QUALIFYING_DEPOSIT_INR_MINOR", value: 25_000, effectiveFrom: new Date("2901-01-01T00:00:00Z"), createdBy: SETTINGS_TAG, reason: "test" },
    });
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 30_000);
    await trade(friend.id, { at: new Date("2900-12-01T00:00:00Z") });
    expect(await evaluateReferralQualification(friend.id, new Date("2901-02-01T00:00:00Z"))).toEqual({ outcome: "not_yet" });
    const t2 = await trade(friend.id, { at: new Date("2901-03-01T00:00:00Z") });
    expect(await evaluateReferralQualification(friend.id, new Date("2901-04-01T00:00:00Z"))).toEqual({ outcome: "qualified" });
    expect(await qualificationOf(friend.id)).toMatchObject({
      qualifyingTradeId: expect.any(String),
      minDepositInrMinor: 25_000,
      qualifiedAt: new Date("2901-03-01T00:00:00Z"),
    });
    expect(t2).toBeTruthy();
  });

  it("the friend extra is not granted again after the first deposit is reversed (ordinary bonus unchanged)", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    const first = await deposit(friend.id, 50_000);
    expect(await bonusOf(first)).toBe(55_000);
    await reverseCompletedDeposit({ depositId: first, adminId: "admin-test", reason: "duplicate" });
    const next = await deposit(friend.id, 50_000);
    expect(await bonusOf(next)).toBe(50_000); // still deposit #1 for the ordinary tier, but no extra
  });

  it("inviteExtraBonusPct returns 0 instead of throwing when the setting is missing", async () => {
    const tx = {
      transaction: { count: async () => 0 },
      fraudFlag: { count: async () => 0 },
      programSetting: { findMany: async () => [] },
    };
    expect(await inviteExtraBonusPct(tx as never, { userId: "u", accountId: "a", at: new Date() })).toEqual({ pct: 0, settingId: null });
  });

  it("a USDT deposit qualifies at its INR value", async () => {
    const aff = await makeUser({ role: "AFFILIATE" });
    const friend = await friendOf(aff.id);
    const usdt = 600 + randomInt(300); // $6–$9, unique-ish against live reservations
    const d = await prisma.deposit.create({
      data: {
        userId: friend.id, method: "USDT", amountInr: -usdt, amountUsd: 0, amountUsdtMinor: usdt, vpa: "T-addr",
        checkoutToken: randomUUID(), correlationId: RUN, expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await creditDepositToAccount({ depositId: d.id, adminId: null });
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    expect(await qualificationOf(friend.id)).toMatchObject({ firstDepositId: d.id, depositInrMinor: usdt * 100 });
    expect((await earningsOf(aff.id))[0]).toMatchObject({ amountMinor: Math.floor((usdt * 100 * 500) / 10_000) });
  });

  it("reversing a non-qualifying deposit leaves the qualification and earning intact", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await trade(friend.id);
    await deposit(friend.id, 50_000);
    const later = await deposit(friend.id, 60_000);
    await reverseCompletedDeposit({ depositId: later, adminId: "admin-test", reason: "wrong user" });
    expect(await qualificationOf(friend.id)).toMatchObject({ status: "QUALIFIED" });
    expect((await earningsOf(inviter.id))[0]).toMatchObject({ status: "PENDING" });
  });

  it("flags later-state earnings for review (no such status exists until Phase 5, so exercised with a stub tx)", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const tx = {
      referralQualification: { findFirst: async () => ({ id: "q1" }), update: async () => ({}) },
      programEarning: { updateMany },
      auditLog: { create: async () => ({}) },
    };
    await reverseQualificationForDeposit(tx as never, { depositId: "d1", reason: "chargeback", actorId: null });
    expect(updateMany).toHaveBeenCalledWith({
      where: { qualificationId: "q1", status: { notIn: ["PENDING", "HELD", "VOID"] } },
      data: { needsReview: true },
    });
  });

  it("evaluates a user with 2,000 small settled trades quickly with bounded queries", async () => {
    const inviter = await makeUser();
    const friend = await friendOf(inviter.id);
    await deposit(friend.id, 50_000);
    const account = await prisma.account.findFirstOrThrow({ where: { userId: friend.id, type: "LIVE" } });
    const now = Date.now();
    await prisma.trade.createMany({
      data: Array.from({ length: 2_000 }, (_, i) => ({
        accountId: account.id, assetId, direction: "UP" as const, stake: 5_000, payoutPct: 80, entryPrice: 1,
        entryTs: new Date(now - 120_000 - i), expiryTs: new Date(now - 60_000 - i), status: "LOST" as const,
      })),
    });
    const raw = vi.spyOn(prisma, "$queryRaw");
    const started = performance.now();
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "not_yet" });
    const ms = performance.now() - started;
    expect(raw.mock.calls.length).toBeGreaterThanOrEqual(1); // the spy really sees the trade lookups
    expect(raw.mock.calls.length).toBeLessThanOrEqual(2);
    raw.mockRestore();
    expect(ms).toBeLessThan(1_000);
  });
});

describe("requested UPI amount (product decision 13 Nov 2026)", () => {
  it("createDepositIntent stores the requested base next to the offset amount", async () => {
    const u = await makeUser();
    const d = await createDepositIntent({ userId: u.id, method: "upi", amountInrMinor: 50_000, correlationId: RUN });
    expect(d.requestedInrMinor).toBe(50_000);
    expect(Math.abs(d.amountInr - 50_000)).toBeLessThanOrEqual(1_000);
  });

  it.each([49_001, 51_000])("a ₹500 request paid as %i paise qualifies and earns exactly ₹25", async (paid) => {
    const aff = await makeUser({ role: "AFFILIATE" });
    const friend = await friendOf(aff.id);
    await deposit(friend.id, paid, 5, 50_000);
    await trade(friend.id);
    expect(await evaluateReferralQualification(friend.id)).toEqual({ outcome: "qualified" });
    expect(await qualificationOf(friend.id)).toMatchObject({ depositInrMinor: 50_000 });
    expect((await earningsOf(aff.id))[0]).toMatchObject({ amountMinor: 2_500 });
    const live = await prisma.account.findFirstOrThrow({ where: { userId: friend.id, type: "LIVE" } });
    expect(live.realBalance).toBe(paid); // the credit is still what was paid
  });
});
