import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { createAccountsForUser } from "./account";
import { PROGRAM_DAY_CLOSE_GRACE_MS, closeDueProgramDays, closeProgramDay, releasePendingEarnings } from "./program-day-close";
import { transferProgramEarningsToTrading } from "./program-transfer";
import {
  ProgramActionRefused,
  addIstDays,
  countProgramWithdrawalsUsed,
  createProgramAdjustment,
  getProgramSummary,
  istDayStart,
  istLimitWindows,
  listProgramActivity,
} from "./program-wallet";
import {
  approveProgramWithdrawal,
  cancelProgramWithdrawal,
  markProgramWithdrawalPaid,
  rejectProgramWithdrawal,
  requestProgramWithdrawal,
} from "./program-withdrawal";
import { revenueShareOf } from "./revenue-share";
import { ProgramActionRefused as SharedRefused } from "./program-errors";
import { listProgramWithdrawalsForAdmin } from "./program-withdrawal";

// Affiliate Program phases 5–6 money core (Affiliate Program spec), §16 checks 6, 9–12.
// Needs the owner URL (RevenueShareDay / ProgramDayClose / ledger are append-only for asm_app).
// Day-close tests use a random far-past IST era so they never close real days; the ProgramDayClose rows
// this run creates are tracked and deleted in afterAll.
const RUN = randomUUID();
const ERA = addIstDays("1981-01-01", randomInt(0, 6000));
let slotN = 0;
/** A fresh 10-day block of far-past IST days per test. */
const slot = () => addIstDays(ERA, 10 * slotN++);
const closedDays = new Set<string>();
let n = 0;
let assetId = "";
const UPI = { method: "UPI" as const, upiId: "test@upi" };
const ADMIN = "admin-panel";

beforeAll(async () => {
  assetId = (await prisma.asset.findFirstOrThrow({ select: { id: true } })).id;
});

afterAll(async () => {
  // Wallets, ledger, transfers, withdrawals, earnings, rates, revenue-share days, trades cascade with their user.
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.programDayClose.deleteMany({ where: { day: { in: [...closedDays].map((d) => new Date(`${d}T00:00:00.000Z`)) } } });
  await prisma.$disconnect();
});

async function close(day: string) {
  const r = await closeProgramDay(day);
  closedDays.add(day);
  return r;
}

async function makeUser(data: Partial<Prisma.UserCreateInput> = {}, currency = "INR") {
  const u = await prisma.user.create({ data: { email: `pm-${n++}-${RUN}@test.local`, passwordHash: "x", ...data } });
  await createAccountsForUser(u.id, 0, currency);
  return u;
}

async function affiliate(opts: { status?: "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL"; kyc?: "VERIFIED" | "NOT_STARTED"; bps?: number } = {}) {
  const u = await makeUser({ role: "AFFILIATE", kycStatus: opts.kyc ?? "VERIFIED", emailVerified: true });
  await prisma.affiliateProfile.create({ data: { userId: u.id, status: opts.status ?? "ACTIVE" } });
  if (opts.bps !== undefined) await rate(u.id, opts.bps, new Date(0));
  return u;
}

const rate = (affiliateId: string, bps: number, effectiveFrom: Date) =>
  prisma.affiliateRate.create({ data: { affiliateId, revenueShareBps: bps, effectiveFrom, createdBy: `test-${RUN}`, reason: "test" } });

/** A referred, QUALIFIED friend of `inviterId` (qualified at `at`). */
async function qualifiedFriend(inviterId: string, at: Date, currency = "INR") {
  const f = await makeUser({ referredBy: { connect: { id: inviterId } }, referredAt: at }, currency);
  const q = await prisma.referralQualification.create({
    data: {
      referredUserId: f.id,
      inviterId,
      firstDepositId: randomUUID(),
      qualifyingTradeId: randomUUID(),
      depositInrMinor: 50_000,
      tradeRealStakeInrMinor: 10_000,
      minDepositInrMinor: 50_000,
      minTradeInrMinor: 10_000,
      settingIds: [],
      qualifiedAt: at,
    },
  });
  return { ...f, qualificationId: q.id };
}

/** A settled trade; `pnl` is the user's result (credit − stake): negative = company gain. */
async function trade(userId: string, at: Date, pnl: number, opts: { stake?: number; fromBonus?: number; currency?: string; status?: "WON" | "LOST" | "CLOSED" | "OPEN" | "REFUNDED"; mode?: "CFD" } = {}) {
  const account = await prisma.account.findFirstOrThrow({ where: { userId, type: "LIVE" } });
  await prisma.trade.create({
    data: {
      accountId: account.id,
      assetId,
      direction: "UP",
      stake: opts.stake ?? Math.max(Math.abs(pnl), 100),
      stakeFromBonus: opts.fromBonus ?? 0,
      payoutPct: 80,
      entryPrice: 1,
      entryTs: new Date(at.getTime() - 60_000),
      expiryTs: at,
      status: opts.status ?? (pnl > 0 ? "WON" : "LOST"),
      pnl,
      currency: opts.currency ?? null,
      ...(opts.mode ? { mode: opts.mode } : {}),
    },
  });
}

/** Noon IST of `day`. */
const noon = (day: string) => new Date(istDayStart(day).getTime() + 12 * 3_600_000);
const wallet = (userId: string) => prisma.programWallet.findUnique({ where: { userId } });
const rsd = (affiliateId: string) => prisma.revenueShareDay.findMany({ where: { affiliateId }, orderBy: { day: "asc" } });

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProgramActionRefused) return err.code;
    throw err;
  }
  return "ok";
}

describe("revenue share math (pure)", () => {
  it("doc examples, carry forward and floor rounding", () => {
    expect(revenueShareOf(40_000, 0, 5_000)).toEqual({ eligibleMinor: 40_000, shareMinor: 20_000, carryOutMinor: 0 });
    expect(revenueShareOf(10_000, 0, 5_000).shareMinor).toBe(5_000); // ₹400 loss + ₹300 win → ₹50
    expect(revenueShareOf(-100_000, 0, 5_000)).toEqual({ eligibleMinor: 0, shareMinor: 0, carryOutMinor: -100_000 });
    expect(revenueShareOf(150_000, -100_000, 5_000)).toEqual({ eligibleMinor: 50_000, shareMinor: 25_000, carryOutMinor: 0 });
    expect(revenueShareOf(3, 0, 5_000).shareMinor).toBe(1); // 1.5 paise → 1
  });
});

describe("IST limit windows (pure)", () => {
  it("day starts at 18:30 UTC; 23:59 IST and 00:00 IST are different days", () => {
    const before = istLimitWindows(new Date("2026-11-14T18:29:59.999Z")); // Sat 23:59:59.999 IST
    const after = istLimitWindows(new Date("2026-11-14T18:30:00.000Z")); // Sun 00:00 IST
    expect(before.dayStart.toISOString()).toBe("2026-11-13T18:30:00.000Z");
    expect(after.dayStart.toISOString()).toBe("2026-11-14T18:30:00.000Z");
  });
  it("week is Monday–Sunday IST", () => {
    const sunday = istLimitWindows(new Date("2026-11-15T18:29:00.000Z")); // Sun 23:59 IST
    const monday = istLimitWindows(new Date("2026-11-15T18:30:00.000Z")); // Mon 00:00 IST
    expect(sunday.weekStart.toISOString()).toBe("2026-11-08T18:30:00.000Z"); // Mon 9 Nov 00:00 IST
    expect(monday.weekStart.toISOString()).toBe("2026-11-15T18:30:00.000Z");
    // 03:00 UTC Monday is still Monday in IST; 20:00 UTC Sunday is already Monday in IST.
    expect(istLimitWindows(new Date("2026-11-15T20:00:00.000Z")).weekStart.toISOString()).toBe("2026-11-15T18:30:00.000Z");
  });
  it("month is the IST calendar month (month end)", () => {
    expect(istLimitWindows(new Date("2026-11-30T18:29:59.000Z")).monthStart.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(istLimitWindows(new Date("2026-11-30T18:30:00.000Z")).monthStart.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
});

describe("daily close — Revenue Share", () => {
  it("winners offset losers within a day (₹400 loss + ₹300 win at 50% → ₹50) and pays AVAILABLE at once", async () => {
    const day = slot();
    const aff = await affiliate({ bps: 5_000 });
    const a = await qualifiedFriend(aff.id, istDayStart(day));
    const b = await qualifiedFriend(aff.id, istDayStart(day));
    await trade(a.id, noon(day), -40_000);
    await trade(b.id, noon(day), 30_000);
    expect(await close(day)).toMatchObject({ closed: true, revenueShareRows: 1 });
    const [row] = await rsd(aff.id);
    expect(row).toMatchObject({ netGainMinor: 10_000, carryInMinor: 0, rateBps: 5_000, eligibleMinor: 10_000, shareMinor: 5_000, carryOutMinor: 0, tradeCount: 2 });
    const e = await prisma.programEarning.findFirstOrThrow({ where: { beneficiaryUserId: aff.id } });
    expect(e).toMatchObject({ kind: "REVENUE_SHARE", status: "AVAILABLE", amountMinor: 5_000, revenueShareDayId: row!.id });
    expect(e.earnedAt).toEqual(istDayStart(addIstDays(day, 1)));
    expect(await wallet(aff.id)).toMatchObject({ availableMinor: 5_000 });
    const ledger = await prisma.programLedgerEntry.findMany({ where: { userId: aff.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: "EARNING_AVAILABLE", amountMinor: 5_000, availableAfter: 5_000, refType: "ProgramEarning", refId: e.id });
  });

  it("doc example: ₹400 loss at 50% → ₹200; close is idempotent (second and concurrent runs change nothing)", async () => {
    const day = slot();
    const aff = await affiliate({ bps: 5_000 });
    const f = await qualifiedFriend(aff.id, istDayStart(day));
    await trade(f.id, noon(day), -40_000);
    const both = await Promise.all([closeProgramDay(day), closeProgramDay(day)]);
    closedDays.add(day);
    expect(both.filter((r) => r.closed)).toHaveLength(1);
    expect((await close(day)).closed).toBe(false);
    expect(await rsd(aff.id)).toHaveLength(1);
    expect(await prisma.programEarning.count({ where: { beneficiaryUserId: aff.id } })).toBe(1);
    expect(await wallet(aff.id)).toMatchObject({ availableMinor: 20_000 });
  });

  it("carries a negative result forward (−₹1,000 then +₹1,500 → ₹500 eligible, ₹250 at 50%) and never claws back", async () => {
    const d1 = slot();
    const d2 = addIstDays(d1, 1);
    const d3 = addIstDays(d1, 2);
    const aff = await affiliate({ bps: 5_000 });
    const f = await qualifiedFriend(aff.id, istDayStart(d1));
    await trade(f.id, noon(d1), 100_000); // friend wins ₹1,000 → company −₹1,000
    await trade(f.id, noon(d2), -150_000); // company +₹1,500
    await trade(f.id, noon(d3), 80_000); // losing day for the company
    await close(d1);
    await close(d2);
    await close(d3);
    const rows = await rsd(aff.id);
    expect(rows.map((r) => [r.netGainMinor, r.carryInMinor, r.eligibleMinor, r.shareMinor, r.carryOutMinor])).toEqual([
      [-100_000, 0, 0, 0, -100_000],
      [150_000, -100_000, 50_000, 25_000, 0],
      [-80_000, 0, 0, 0, -80_000],
    ]);
    expect(await wallet(aff.id)).toMatchObject({ availableMinor: 25_000 }); // day 3 took nothing back
    expect((await getProgramSummary(aff.id)).carryForwardMinor).toBe(-80_000);
  });

  it("counts only the real-money share of a bonus-funded trade, converts USD and ignores pre-qualification / flagged / open trades", async () => {
    const day = slot();
    const aff = await affiliate({ bps: 5_000 });
    const bonus = await qualifiedFriend(aff.id, istDayStart(day));
    await trade(bonus.id, noon(day), -100_000, { stake: 100_000, fromBonus: 50_000 }); // real part ₹500
    const usd = await qualifiedFriend(aff.id, istDayStart(day), "USD");
    await trade(usd.id, noon(day), -400, { currency: "USD" }); // $4 = ₹400
    const late = await qualifiedFriend(aff.id, noon(day));
    await trade(late.id, new Date(noon(day).getTime() - 1), -999_00); // before qualifiedAt
    await trade(late.id, noon(day), -999_00, { status: "OPEN", mode: "CFD" }); // open CFD position: not counted, never waited for
    const flagged = await qualifiedFriend(aff.id, istDayStart(day));
    await prisma.fraudFlag.create({ data: { userId: flagged.id, kind: "SELF_REFERRAL", status: "OPEN", linkedUserIds: [flagged.id], evidence: {} } });
    await trade(flagged.id, noon(day), -999_00);
    await trade(bonus.id, istDayStart(addIstDays(day, 1)), -999_00); // next IST day
    await close(day);
    const [row] = await rsd(aff.id);
    expect(row).toMatchObject({ netGainMinor: 50_000 + 40_000, tradeCount: 2, shareMinor: 45_000 });
  });

  it("a rate change only affects later days", async () => {
    const d1 = slot();
    const d2 = addIstDays(d1, 1);
    const aff = await affiliate({ bps: 5_000 });
    await rate(aff.id, 2_000, istDayStart(d2));
    const f = await qualifiedFriend(aff.id, istDayStart(d1));
    await trade(f.id, noon(d1), -10_000);
    await trade(f.id, noon(d2), -10_000);
    await close(d1);
    await close(d2);
    expect((await rsd(aff.id)).map((r) => [r.rateBps, r.shareMinor])).toEqual([
      [5_000, 5_000],
      [2_000, 2_000],
    ]);
  });

  it("computes huge positions without bigint overflow and truncates each trade toward zero", async () => {
    const day = slot();
    const big = await affiliate({ bps: 5_000 });
    const f = await qualifiedFriend(big.id, istDayStart(day));
    await trade(f.id, noon(day), -4_000_000_000_000, { stake: 4_000_000_000_000 }); // product 1.6e25 > bigint max
    const small = await affiliate({ bps: 5_000 });
    const g = await qualifiedFriend(small.id, istDayStart(day));
    await trade(g.id, noon(day), -2, { stake: 3, fromBonus: 1 }); // 2 x 2 / 3 = 1.33 -> 1
    await trade(g.id, noon(day), 2, { stake: 3, fromBonus: 1 }); // -1.33 -> -1 (toward zero, not -2)
    await close(day);
    expect((await rsd(big.id))[0]).toMatchObject({ netGainMinor: 4_000_000_000_000, shareMinor: 2_000_000_000_000 });
    expect((await rsd(small.id))[0]).toMatchObject({ netGainMinor: 0, tradeCount: 2, shareMinor: 0 });
  });

  it("waits 15 minutes after midnight and for unsettled fixed-expiry trades; CFD positions never block", async () => {
    const day = slot();
    const end = istDayStart(addIstDays(day, 1));
    await expect(closeProgramDay(day, new Date(end.getTime() + PROGRAM_DAY_CLOSE_GRACE_MS - 1))).rejects.toThrow(/not ended/);

    const aff = await affiliate({ bps: 5_000 });
    const f = await qualifiedFriend(aff.id, istDayStart(day));
    await trade(f.id, noon(day), -999_00, { status: "OPEN", mode: "CFD" });
    await trade(f.id, noon(day), 0, { status: "OPEN", stake: 40_000 }); // expired, settlement still pending
    expect(await closeProgramDay(day)).toMatchObject({ closed: false, deferred: true });
    expect(await prisma.programDayClose.findUnique({ where: { day: new Date(`${day}T00:00:00.000Z`) } })).toBeNull();
    expect(await rsd(aff.id)).toHaveLength(0);
    const due = await closeDueProgramDays(noon(addIstDays(day, 3)));
    for (const d of due.closedDays) closedDays.add(d);
    expect(due.closedDays.every((d) => d < day)).toBe(true); // stops at the deferred day

    // The late settlement lands, then the day closes with it included.
    await prisma.trade.updateMany({ where: { account: { userId: f.id }, status: "OPEN", mode: { not: "CFD" } }, data: { status: "LOST", pnl: -40_000 } });
    expect(await close(day)).toMatchObject({ closed: true, deferred: false });
    expect((await rsd(aff.id))[0]).toMatchObject({ netGainMinor: 40_000, shareMinor: 20_000 });
  });

  it("holds revenue share for a non-active affiliate", async () => {
    const day = slot();
    const aff = await affiliate({ bps: 5_000, status: "SUSPENDED" });
    const f = await qualifiedFriend(aff.id, istDayStart(day));
    await trade(f.id, noon(day), -40_000);
    await close(day);
    const e = await prisma.programEarning.findFirstOrThrow({ where: { beneficiaryUserId: aff.id } });
    expect(e).toMatchObject({ status: "HELD", holdReason: "affiliate not active", amountMinor: 20_000 });
    expect(await wallet(aff.id)).toBeNull();
  });
});

describe("daily close — release of PENDING earnings", () => {
  async function pendingEarning(beneficiaryUserId: string, earnedAt: Date, qualificationId: string | null = null) {
    return prisma.programEarning.create({
      data: { beneficiaryUserId, qualificationId, kind: "REFERRAL_REWARD", amountMinor: 5_000, status: "PENDING", earnedAt, settingIds: [] },
    });
  }

  it("releases earnings earned before the close, re-checks holds, leaves later earnings PENDING", async () => {
    const day = slot();
    const inviter = await makeUser();
    const friend = await qualifiedFriend(inviter.id, noon(day));
    const ok = await pendingEarning(inviter.id, noon(day), friend.qualificationId);
    const later = await pendingEarning(inviter.id, istDayStart(addIstDays(day, 1)));
    const frozen = await makeUser({ status: "FROZEN" });
    const heldFrozen = await pendingEarning(frozen.id, noon(day));
    const inviter2 = await makeUser();
    const flaggedFriend = await qualifiedFriend(inviter2.id, noon(day));
    const heldFlag = await pendingEarning(inviter2.id, noon(day), flaggedFriend.qualificationId);
    await prisma.fraudFlag.create({ data: { userId: flaggedFriend.id, kind: "SELF_REFERRAL", status: "CONFIRMED", linkedUserIds: [flaggedFriend.id, inviter2.id], evidence: {} } });
    const suspended = await affiliate({ status: "SUSPENDED" });
    const heldAff = await pendingEarning(suspended.id, noon(day));

    await close(day);
    const by = async (id: string) => prisma.programEarning.findUniqueOrThrow({ where: { id } });
    expect(await by(ok.id)).toMatchObject({ status: "AVAILABLE" });
    expect(await by(later.id)).toMatchObject({ status: "PENDING" });
    expect(await by(heldFrozen.id)).toMatchObject({ status: "HELD", holdReason: "beneficiary FROZEN" });
    expect(await by(heldFlag.id)).toMatchObject({ status: "HELD", holdReason: "self-referral flag open or confirmed" });
    expect(await by(heldAff.id)).toMatchObject({ status: "HELD", holdReason: "affiliate not active" });
    expect(await wallet(inviter.id)).toMatchObject({ availableMinor: 5_000 });
    expect(await wallet(frozen.id)).toBeNull();

    // Held earnings are not released by later closes.
    await close(addIstDays(day, 1));
    expect(await by(heldFrozen.id)).toMatchObject({ status: "HELD" });
    expect(await by(later.id)).toMatchObject({ status: "AVAILABLE" });
    expect(await wallet(inviter.id)).toMatchObject({ availableMinor: 10_000 });
  });

  it("a row voided between read and release stays VOID (both the release and the re-hold paths)", async () => {
    const day = slot();
    const inviter = await makeUser();
    const frozen = await makeUser({ status: "FROZEN" });
    const a = await pendingEarning(inviter.id, noon(day));
    const b = await pendingEarning(frozen.id, noon(day));
    const select = { id: true, beneficiaryUserId: true, amountMinor: true, adminReleasedAt: true, qualification: { select: { referredUserId: true } } } as const;
    const stale = await prisma.programEarning.findMany({ where: { id: { in: [a.id, b.id] } }, select });
    // A deposit reversal voids both after the close read them.
    await prisma.programEarning.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { status: "VOID", voidReason: "reversed" } });
    expect(await prisma.$transaction((tx) => releasePendingEarnings(tx, stale))).toBe(0);
    for (const id of [a.id, b.id]) expect(await prisma.programEarning.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "VOID", voidReason: "reversed" });
    expect(await wallet(inviter.id)).toMatchObject({ availableMinor: 0 });
    expect(await prisma.programLedgerEntry.count({ where: { userId: inviter.id } })).toBe(0);
  });

  it("an admin-released earning (HELD → PENDING) becomes AVAILABLE at the next close even though the hold reason still stands", async () => {
    const day = slot();
    const frozen = await makeUser({ status: "FROZEN" });
    const e = await pendingEarning(frozen.id, noon(day));
    await close(day);
    expect(await prisma.programEarning.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "HELD" });
    // What releaseHeldEarning (program-admin.ts) writes.
    await prisma.programEarning.update({ where: { id: e.id }, data: { status: "PENDING", holdReason: null, adminReleasedAt: new Date() } });
    await close(addIstDays(day, 1));
    expect(await prisma.programEarning.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "AVAILABLE" });
    expect(await wallet(frozen.id)).toMatchObject({ availableMinor: 5_000 });
    // The account status still blocks moving it out.
    expect(await refusal(transferProgramEarningsToTrading({ userId: frozen.id, amountMinor: 100, idempotencyKey: randomUUID() }))).toBe("account_frozen");
  });

  it("closeDueProgramDays closes each due day once even when two processes run it concurrently", async () => {
    const first = slot();
    const inviter = await makeUser();
    const e = await pendingEarning(inviter.id, noon(first));
    const now = noon(addIstDays(first, 3));
    const [a, b] = await Promise.all([closeDueProgramDays(now), closeDueProgramDays(now)]);
    for (const d of [...a.closedDays, ...b.closedDays]) closedDays.add(d);
    const all = [...a.closedDays, ...b.closedDays];
    expect(new Set(all).size).toBe(all.length); // no day closed twice
    for (const d of [first, addIstDays(first, 1), addIstDays(first, 2)]) expect(all).toContain(d);
    expect(all).not.toContain(addIstDays(first, 3)); // today is not due
    expect(await prisma.programEarning.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "AVAILABLE" });
    expect(await wallet(inviter.id)).toMatchObject({ availableMinor: 5_000 });
    expect((await closeDueProgramDays(now)).closedDays).toEqual([]);
  });

  it("refuses to close a day that has not ended", async () => {
    await expect(closeProgramDay(ERA, noon(ERA))).rejects.toThrow(/not ended/);
    await expect(closeProgramDay("2999-01-01")).rejects.toThrow(/not ended/);
    await expect(closeProgramDay("2026-02-30")).rejects.toThrow(/Invalid IST day/);
  });
});

describe("transfers to trading", () => {
  it("pending and held money cannot be transferred or withdrawn", async () => {
    const u = await affiliate();
    await prisma.programEarning.create({ data: { beneficiaryUserId: u.id, kind: "REFERRAL_REWARD", amountMinor: 500_000, status: "PENDING", earnedAt: new Date(), settingIds: [] } });
    await prisma.programEarning.create({ data: { beneficiaryUserId: u.id, kind: "REFERRAL_REWARD", amountMinor: 500_000, status: "HELD", earnedAt: new Date(), settingIds: [] } });
    expect(await refusal(transferProgramEarningsToTrading({ userId: u.id, amountMinor: 100, idempotencyKey: randomUUID() }))).toBe("insufficient_funds");
    expect(await refusal(requestProgramWithdrawal({ userId: u.id, amountMinor: 200_000, payout: UPI, idempotencyKey: randomUUID() }))).toBe("insufficient_funds");
    const s = await getProgramSummary(u.id);
    expect(s).toMatchObject({ pendingMinor: 500_000, heldMinor: 500_000, availableMinor: 0, canTransfer: false, canWithdraw: false });
  });

  it("moves exactly ₹400 into the LIVE account as PROGRAM_TRANSFER, no deposit or bonus, idempotently", async () => {
    const u = await affiliate();
    await createProgramAdjustment({ userId: u.id, amountMinor: 100_000, reason: "test credit", actor: ADMIN, idempotencyKey: randomUUID() });
    const key = randomUUID();
    const r = await transferProgramEarningsToTrading({ userId: u.id, amountMinor: 40_000, idempotencyKey: key });
    expect(r).toMatchObject({ creditedMinor: 40_000, creditedCurrency: "INR" });
    const again = await transferProgramEarningsToTrading({ userId: u.id, amountMinor: 40_000, idempotencyKey: key });
    expect(again).toEqual(r);

    const acct = await prisma.account.findFirstOrThrow({ where: { userId: u.id, type: "LIVE" } });
    expect(acct).toMatchObject({ realBalance: 40_000, bonusBalance: 0 });
    const txs = await prisma.transaction.findMany({ where: { accountId: acct.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: "PROGRAM_TRANSFER", amount: 40_000, refType: "ProgramTransfer", refId: r.transferId });
    expect(await prisma.deposit.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.bonusGrant.count({ where: { accountId: acct.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).cumulativeDeposits).toBe(0);
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 60_000, transferredMinor: 40_000 });
  });

  it("converts to a USD account, rounding down", async () => {
    const u = await makeUser({}, "USD");
    await createProgramAdjustment({ userId: u.id, amountMinor: 40_099, reason: "test credit", actor: ADMIN, idempotencyKey: randomUUID() });
    const r = await transferProgramEarningsToTrading({ userId: u.id, amountMinor: 40_099, idempotencyKey: randomUUID() });
    expect(r).toMatchObject({ creditedMinor: 400, creditedCurrency: "USD" }); // $4.00, never $4.01
  });

  it("concurrent transfers can't spend the same money", async () => {
    const u = await makeUser();
    await createProgramAdjustment({ userId: u.id, amountMinor: 100_000, reason: "test credit", actor: ADMIN, idempotencyKey: randomUUID() });
    const results = await Promise.all([0, 1, 2].map(() => refusal(transferProgramEarningsToTrading({ userId: u.id, amountMinor: 60_000, idempotencyKey: randomUUID() }))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "insufficient_funds")).toHaveLength(2);
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 40_000, transferredMinor: 60_000 });
  });

  it("refuses a reused idempotency key with a different amount or destination", async () => {
    const u = await affiliate();
    await createProgramAdjustment({ userId: u.id, amountMinor: 1_000_000, reason: "test credit", actor: ADMIN, idempotencyKey: randomUUID() });
    const tk = randomUUID();
    await transferProgramEarningsToTrading({ userId: u.id, amountMinor: 1_000, idempotencyKey: tk });
    expect(await refusal(transferProgramEarningsToTrading({ userId: u.id, amountMinor: 2_000, idempotencyKey: tk }))).toBe("invalid_state");
    const wk = randomUUID();
    await requestProgramWithdrawal({ userId: u.id, amountMinor: 200_000, payout: UPI, idempotencyKey: wk });
    expect(await refusal(requestProgramWithdrawal({ userId: u.id, amountMinor: 300_000, payout: UPI, idempotencyKey: wk }))).toBe("invalid_state");
    expect(await refusal(requestProgramWithdrawal({ userId: u.id, amountMinor: 200_000, payout: { method: "UPI", upiId: "other@upi" }, idempotencyKey: wk }))).toBe("invalid_state");
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 1_000_000 - 1_000 - 200_000, reservedMinor: 200_000 });
  });

  it("activity never exposes hold/void reasons; only a rejected withdrawal's reason is shown", async () => {
    const u = await affiliate();
    await prisma.programEarning.create({ data: { beneficiaryUserId: u.id, kind: "REFERRAL_REWARD", amountMinor: 5_000, status: "HELD", holdReason: "self-referral flag open or confirmed", earnedAt: new Date(), settingIds: [] } });
    await prisma.programEarning.create({ data: { beneficiaryUserId: u.id, kind: "REFERRAL_REWARD", amountMinor: 5_000, status: "VOID", voidReason: "Qualifying deposit abc reversed: chargeback", earnedAt: new Date(), settingIds: [] } });
    await createProgramAdjustment({ userId: u.id, amountMinor: 500_000, reason: "internal admin note", actor: ADMIN, idempotencyKey: randomUUID() });
    const w = await requestProgramWithdrawal({ userId: u.id, amountMinor: 200_000, payout: UPI, idempotencyKey: randomUUID() });
    await approveProgramWithdrawal({ id: w.id, actor: ADMIN, note: "approved note" });
    const items = await listProgramActivity(u.id, { limit: 20 });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.reason === null)).toBe(true);
    await rejectProgramWithdrawal({ id: w.id, actor: ADMIN, reason: "name mismatch" });
    expect((await listProgramActivity(u.id, { limit: 20 })).find((i) => i.id === w.id)?.reason).toBe("name mismatch");
  });

  it("KYC, affiliate status and frozen refusals", async () => {
    const credit = async (id: string) => createProgramAdjustment({ userId: id, amountMinor: 300_000, reason: "test", actor: ADMIN, idempotencyKey: randomUUID() });
    const t = (id: string) => refusal(transferProgramEarningsToTrading({ userId: id, amountMinor: 100, idempotencyKey: randomUUID() }));
    const w = (id: string) => refusal(requestProgramWithdrawal({ userId: id, amountMinor: 200_000, payout: UPI, idempotencyKey: randomUUID() }));

    const regular = await makeUser(); // regular user: no KYC needed to transfer, needed to withdraw
    await credit(regular.id);
    expect(await t(regular.id)).toBe("ok");
    expect(await w(regular.id)).toBe("kyc_required");

    const noKycAff = await affiliate({ kyc: "NOT_STARTED" });
    await credit(noKycAff.id);
    expect(await t(noKycAff.id)).toBe("kyc_required");
    expect(await w(noKycAff.id)).toBe("kyc_required");

    for (const status of ["SUSPENDED", "PENDING_APPROVAL"] as const) {
      const a = await affiliate({ status });
      await credit(a.id);
      expect(await t(a.id)).toBe("affiliate_not_active");
      expect(await w(a.id)).toBe("affiliate_not_active");
      expect((await getProgramSummary(a.id)).blockers).toContain("affiliate_not_active");
    }

    const frozen = await affiliate();
    await credit(frozen.id);
    await prisma.user.update({ where: { id: frozen.id }, data: { status: "FROZEN" } });
    expect(await t(frozen.id)).toBe("account_frozen");
    expect(await w(frozen.id)).toBe("account_frozen");

    const adj = await refusal(createProgramAdjustment({ userId: regular.id, amountMinor: -10_000_000, reason: "too much", actor: ADMIN, idempotencyKey: randomUUID() }));
    expect(adj).toBe("insufficient_funds");
  });
});

describe("admin adjustment and shared error class", () => {
  it("throws the single ProgramActionRefused from program-errors (instanceof works for callers)", async () => {
    const u = await makeUser();
    const err = await requestProgramWithdrawal({ userId: u.id, amountMinor: 1, payout: UPI, idempotencyKey: randomUUID() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SharedRefused);
    expect(ProgramActionRefused).toBe(SharedRefused);
    const adj = await createProgramAdjustment({ userId: u.id, amountMinor: -1, reason: "r", actor: ADMIN, idempotencyKey: randomUUID() }).catch((e: unknown) => e);
    expect(adj).toBeInstanceOf(SharedRefused);
  });

  it("a double-submitted adjustment applies once and the retry returns the original result", async () => {
    const u = await makeUser();
    const key = randomUUID();
    const input = { userId: u.id, amountMinor: 12_345, reason: "goodwill", actor: ADMIN, idempotencyKey: key };
    const [a, b] = await Promise.all([createProgramAdjustment(input), createProgramAdjustment(input)]);
    expect(a).toEqual({ earningId: key, availableMinor: 12_345 });
    expect(b).toEqual(a);
    await createProgramAdjustment({ ...input, idempotencyKey: randomUUID() });
    expect(await createProgramAdjustment(input)).toEqual(a); // later retry still returns the original
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 24_690 });
    expect(await prisma.programLedgerEntry.count({ where: { userId: u.id, kind: "ADJUSTMENT" } })).toBe(2);
    expect(await refusal(createProgramAdjustment({ ...input, amountMinor: 1 }))).toBe("invalid_state"); // key reused for different input
    expect(await refusal(createProgramAdjustment({ ...input, idempotencyKey: "not-a-uuid" }))).toBe("invalid_state");
  });
});

describe("program withdrawals", () => {
  async function funded(amount = 1_000_000) {
    const u = await affiliate();
    await createProgramAdjustment({ userId: u.id, amountMinor: amount, reason: "test credit", actor: ADMIN, idempotencyKey: randomUUID() });
    return u;
  }
  const req = (userId: string, amountMinor: number, idempotencyKey = randomUUID()) =>
    requestProgramWithdrawal({ userId, amountMinor, payout: UPI, idempotencyKey });

  it("enforces the ₹1,999 minimum and reserves the amount; retries return the original request", async () => {
    const u = await funded();
    expect(await refusal(req(u.id, 199_899))).toBe("below_minimum");
    const key = randomUUID();
    const w = await req(u.id, 199_900, key);
    expect(w).toMatchObject({ status: "REQUESTED", amountMinor: 199_900, method: "UPI", upiId: "test@upi", destinationKey: "upi:test@upi" });
    expect((await req(u.id, 199_900, key)).id).toBe(w.id);
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 1_000_000 - 199_900, reservedMinor: 199_900 });
    expect(await prisma.programLedgerEntry.count({ where: { userId: u.id, kind: "WITHDRAWAL_RESERVE" } })).toBe(1);
  });

  it("a pending (requested) withdrawal can't be spent twice by concurrent requests", async () => {
    const u = await funded(300_000);
    const results = await Promise.all([0, 1, 2].map(() => refusal(req(u.id, 250_000))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 50_000, reservedMinor: 250_000 });
    expect(await refusal(transferProgramEarningsToTrading({ userId: u.id, amountMinor: 60_000, idempotencyKey: randomUUID() }))).toBe("insufficient_funds");
  });

  it("counts REQUESTED/APPROVED/PAID against the IST day limit; cancelled and rejected don't count", async () => {
    const u = await funded();
    const first = await req(u.id, 200_000);
    expect(await refusal(req(u.id, 200_000))).toBe("limit_day");
    await cancelProgramWithdrawal({ userId: u.id, withdrawalId: first.id });
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 1_000_000, reservedMinor: 0 });
    const second = await req(u.id, 200_000);
    await rejectProgramWithdrawal({ id: second.id, actor: ADMIN, reason: "bad details" });
    const third = await req(u.id, 200_000);
    await approveProgramWithdrawal({ id: third.id, actor: ADMIN });
    expect(await refusal(req(u.id, 200_000))).toBe("limit_day");
    expect((await getProgramSummary(u.id)).used.day).toBe(1);
  });

  it("counts withdrawals against IST day/week/month boundaries", async () => {
    const u = await makeUser();
    const now = new Date();
    const w = istLimitWindows(now);
    const at = [w.dayStart, w.weekStart, w.monthStart].flatMap((t) => [new Date(t.getTime() - 1), t]);
    const statuses = ["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED"] as const;
    for (const createdAt of at) {
      for (const status of statuses) {
        await prisma.programWithdrawal.create({ data: { userId: u.id, amountMinor: 1, method: "UPI", status, idempotencyKey: randomUUID(), createdAt } });
      }
    }
    const count = (start: Date) => at.filter((t) => t.getTime() >= start.getTime()).length * 3; // 3 counting statuses
    expect(await countProgramWithdrawalsUsed(u.id, now)).toEqual({ day: count(w.dayStart), week: count(w.weekStart), month: count(w.monthStart) });
  });

  it("approve then reject releases the funds; the user sees the reason", async () => {
    const u = await funded();
    const w = await req(u.id, 300_000);
    await approveProgramWithdrawal({ id: w.id, actor: ADMIN, note: "ok" });
    expect(await refusal(cancelProgramWithdrawal({ userId: u.id, withdrawalId: w.id }))).toBe("invalid_state"); // user cancels only while REQUESTED
    const rej = await rejectProgramWithdrawal({ id: w.id, actor: ADMIN, reason: "name mismatch" });
    expect(rej).toMatchObject({ status: "REJECTED", reason: "name mismatch" });
    expect((await rejectProgramWithdrawal({ id: w.id, actor: ADMIN, reason: "again" })).reason).toBe("name mismatch"); // retry
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 1_000_000, reservedMinor: 0, paidMinor: 0 });
    const activity = await listProgramActivity(u.id, { limit: 10 });
    expect(activity.find((a) => a.id === w.id)).toMatchObject({ type: "WITHDRAWAL", status: "REJECTED", reason: "name mismatch", method: "UPI" });
    expect(await prisma.auditLog.count({ where: { targetType: "ProgramWithdrawal", targetId: w.id } })).toBe(2);
  });

  it("paid requires approved; paid moves reserved to paid once", async () => {
    const u = await funded();
    const w = await req(u.id, 300_000);
    expect(await refusal(markProgramWithdrawalPaid({ id: w.id, actor: ADMIN, paymentReference: "UTR1" }))).toBe("invalid_state");
    await approveProgramWithdrawal({ id: w.id, actor: ADMIN });
    expect(await wallet(u.id)).toMatchObject({ reservedMinor: 300_000, paidMinor: 0 }); // approval is not payment
    const paid = await markProgramWithdrawalPaid({ id: w.id, actor: ADMIN, paymentReference: "UTR1" });
    expect(paid).toMatchObject({ status: "PAID", paymentReference: "UTR1" });
    await markProgramWithdrawalPaid({ id: w.id, actor: ADMIN, paymentReference: "UTR1" }); // retry
    expect(await wallet(u.id)).toMatchObject({ availableMinor: 700_000, reservedMinor: 0, paidMinor: 300_000 });
    expect(await refusal(rejectProgramWithdrawal({ id: w.id, actor: ADMIN, reason: "late" }))).toBe("invalid_state");
    expect(await prisma.programLedgerEntry.count({ where: { userId: u.id, kind: "WITHDRAWAL_PAID" } })).toBe(1);
  });

  it("admin queue shows how many OTHER users used the same destination (program or trading withdrawals)", async () => {
    const upi = { method: "UPI" as const, upiId: `shared-${RUN.slice(0, 8)}@upi` };
    const key = `upi:${upi.upiId}`;
    const a = await funded();
    const w = await requestProgramWithdrawal({ userId: a.id, amountMinor: 200_000, payout: upi, idempotencyKey: randomUUID() });
    // The queue is oldest first; page through until this row shows up.
    const find = async () => {
      for (let page = 1; page < 200; page++) {
        const r = (await listProgramWithdrawalsForAdmin({ status: "REQUESTED", page })).rows;
        const hit = r.find((x) => x.id === w.id);
        if (hit || r.length === 0) return hit;
      }
    };
    expect((await find())?.sharedDestinationUserCount).toBe(0);
    const b = await funded();
    await requestProgramWithdrawal({ userId: b.id, amountMinor: 200_000, payout: upi, idempotencyKey: randomUUID() });
    const c = await makeUser();
    await prisma.withdrawal.create({ data: { userId: c.id, amount: 70_000, method: "UPI", upiId: upi.upiId, destinationKey: key } });
    await prisma.withdrawal.create({ data: { userId: c.id, amount: 70_000, method: "UPI", upiId: upi.upiId, destinationKey: key } });
    await prisma.withdrawal.create({ data: { userId: a.id, amount: 70_000, method: "UPI", upiId: upi.upiId, destinationKey: key } }); // own: not counted
    expect((await find())?.sharedDestinationUserCount).toBe(2);
  });

  it("a user can't cancel someone else's withdrawal", async () => {
    const u = await funded();
    const other = await makeUser();
    const w = await req(u.id, 200_000);
    expect(await refusal(cancelProgramWithdrawal({ userId: other.id, withdrawalId: w.id }))).toBe("not_found");
  });
});
