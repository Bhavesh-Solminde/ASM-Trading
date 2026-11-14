import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ ok: true }));
const db = vi.hoisted(() => {
  class ProgramActionRefused extends Error {
    constructor(readonly code: string, message: string = code) {
      super(message);
      this.name = "ProgramActionRefused";
    }
  }
  return {
    ProgramActionRefused,
    ProgramSettingKey: { PROGRAM_MIN_WITHDRAWAL_INR_MINOR: "PROGRAM_MIN_WITHDRAWAL_INR_MINOR", AFFILIATE_DEPOSIT_REWARD_BPS: "AFFILIATE_DEPOSIT_REWARD_BPS" },
    appendAffiliateRate: vi.fn(),
    appendProgramSetting: vi.fn(),
    approveProgramWithdrawal: vi.fn(),
    clearNeedsReview: vi.fn(),
    createProgramAdjustment: vi.fn(),
    markProgramWithdrawalPaid: vi.fn(),
    rejectProgramWithdrawal: vi.fn(),
    releaseHeldEarning: vi.fn(),
    setAffiliateStatus: vi.fn(),
    voidHeldEarning: vi.fn(),
    prisma: { user: { findMany: vi.fn() } },
  };
});

class Redirect extends Error {}
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "t" }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/admin-session", () => ({ ADMIN_SESSION_COOKIE: "c", readAdminSession: async () => session.ok }));
vi.mock("@asm/db", () => db);

import * as A from "./actions";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** Runs an action and returns the URL it redirected to. */
async function run(action: (f: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  try {
    await action(form(fields));
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.message);
    throw e;
  }
  throw new Error("no redirect");
}

beforeEach(() => {
  session.ok = true;
  vi.clearAllMocks();
});

describe("affiliate-program admin actions", () => {
  it("refuse without an admin session and touch nothing", async () => {
    session.ok = false;
    const all = [
      A.scheduleSettingAction,
      A.setAffiliateStatusAction,
      A.assignAffiliateRateAction,
      A.approveProgramWithdrawalAction,
      A.rejectProgramWithdrawalAction,
      A.markProgramWithdrawalPaidAction,
      A.releaseHeldEarningAction,
      A.voidHeldEarningAction,
      A.clearNeedsReviewAction,
      A.createProgramAdjustmentAction,
    ];
    for (const action of all) await expect(action(form({ reason: "x" }))).rejects.toThrow("Not authorised.");
    for (const fn of Object.values(db)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });

  it("schedules a setting in stored units, effective now by default", async () => {
    const url = await run(A.scheduleSettingAction, { key: "PROGRAM_MIN_WITHDRAWAL_INR_MINOR", value: "2,499.50", reason: "raise min" });
    expect(url).toContain("ok=");
    const arg = db.appendProgramSetting.mock.calls[0]![0];
    expect(arg).toMatchObject({ key: "PROGRAM_MIN_WITHDRAWAL_INR_MINOR", value: 249_950, reason: "raise min", actor: "admin-panel" });
    expect(Math.abs(arg.effectiveFrom.getTime() - Date.now())).toBeLessThan(5_000);

    await run(A.scheduleSettingAction, { key: "AFFILIATE_DEPOSIT_REWARD_BPS", value: "7.25", reason: "r", effectiveFrom: "2030-01-01T00:00" });
    expect(db.appendProgramSetting.mock.calls[1]![0]).toMatchObject({ value: 725, effectiveFrom: new Date("2029-12-31T18:30:00Z") });
  });

  it("requires a reason and a valid value", async () => {
    expect(await run(A.scheduleSettingAction, { key: "PROGRAM_MIN_WITHDRAWAL_INR_MINOR", value: "10" })).toContain("reason is required");
    expect(await run(A.scheduleSettingAction, { key: "PROGRAM_MIN_WITHDRAWAL_INR_MINOR", value: "1.234", reason: "r" })).toContain("error=");
    expect(await run(A.scheduleSettingAction, { key: "BOGUS", value: "1", reason: "r" })).toContain("Pick a setting");
    expect(await run(A.setAffiliateStatusAction, { userId: "u1", status: "ACTIVE" })).toContain("reason is required");
    expect(await run(A.setAffiliateStatusAction, { userId: "u1", status: "PENDING_APPROVAL", reason: "r" })).toContain("Pick a status");
    expect(await run(A.rejectProgramWithdrawalAction, { withdrawalId: "w1" })).toContain("reason is required");
    expect(await run(A.markProgramWithdrawalPaidAction, { withdrawalId: "w1" })).toContain("payment reference is required");
    expect(await run(A.releaseHeldEarningAction, { earningId: "e1" })).toContain("note is required");
    expect(await run(A.voidHeldEarningAction, { earningId: "e1" })).toContain("reason is required");
    expect(await run(A.clearNeedsReviewAction, { earningId: "e1" })).toContain("note is required");
    expect(await run(A.createProgramAdjustmentAction, { user: "a@b.c", amount: "0", reason: "r", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" })).toContain("non-zero");
    expect(await run(A.assignAffiliateRateAction, { affiliateId: "a1", revenueSharePct: "101", reason: "r" })).toContain("0 to 100");
    for (const fn of Object.values(db)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });

  it("assigns a rate in bps; an empty override means the global setting", async () => {
    const url = await run(A.assignAffiliateRateAction, { affiliateId: "a1", revenueSharePct: "30", reason: "deal" });
    expect(url).toMatch(/^\/admin\/affiliate-program\/affiliates\/a1\?ok=/);
    expect(db.appendAffiliateRate.mock.calls[0]![0]).toMatchObject({ affiliateId: "a1", revenueShareBps: 3_000, depositRewardBps: null, actor: "admin-panel" });
    await run(A.assignAffiliateRateAction, { affiliateId: "a1", revenueSharePct: "12.5", depositRewardPct: "2.75", reason: "deal" });
    expect(db.appendAffiliateRate.mock.calls[1]![0]).toMatchObject({ revenueShareBps: 1_250, depositRewardBps: 275 });
  });

  it("calls the right db function for each action", async () => {
    await run(A.setAffiliateStatusAction, { userId: "u1", status: "SUSPENDED", reason: "abuse" });
    expect(db.setAffiliateStatus).toHaveBeenCalledWith({ userId: "u1", status: "SUSPENDED", reason: "abuse", actor: "admin-panel" });
    await run(A.approveProgramWithdrawalAction, { withdrawalId: "w1" });
    expect(db.approveProgramWithdrawal).toHaveBeenCalledWith({ id: "w1", actor: "admin-panel" });
    await run(A.rejectProgramWithdrawalAction, { withdrawalId: "w1", reason: "bad IFSC" });
    expect(db.rejectProgramWithdrawal).toHaveBeenCalledWith({ id: "w1", actor: "admin-panel", reason: "bad IFSC" });
    await run(A.markProgramWithdrawalPaidAction, { withdrawalId: "w1", paymentReference: "UTR123" });
    expect(db.markProgramWithdrawalPaid).toHaveBeenCalledWith({ id: "w1", actor: "admin-panel", paymentReference: "UTR123" });
    await run(A.releaseHeldEarningAction, { earningId: "e1", note: "ok" });
    expect(db.releaseHeldEarning).toHaveBeenCalledWith({ earningId: "e1", actor: "admin-panel", note: "ok" });
    await run(A.voidHeldEarningAction, { earningId: "e1", reason: "fraud" });
    expect(db.voidHeldEarning).toHaveBeenCalledWith({ earningId: "e1", actor: "admin-panel", reason: "fraud" });
    await run(A.clearNeedsReviewAction, { earningId: "e1", note: "checked" });
    expect(db.clearNeedsReview).toHaveBeenCalledWith({ earningId: "e1", actor: "admin-panel", note: "checked" });
  });

  it("looks the adjustment user up by id or email and passes signed paise", async () => {
    db.prisma.user.findMany.mockResolvedValueOnce([{ id: "u9" }]);
    const url = await run(A.createProgramAdjustmentAction, { user: "X@Y.com", amount: "-99.50", reason: "clawback", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" });
    expect(url).toContain("ok=");
    expect(db.prisma.user.findMany.mock.calls[0]![0].where.OR).toEqual([{ id: "X@Y.com" }, { email: { equals: "X@Y.com", mode: "insensitive" } }]);
    expect(db.createProgramAdjustment).toHaveBeenCalledWith({ userId: "u9", amountMinor: -9_950, reason: "clawback", actor: "admin-panel", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" });

    db.prisma.user.findMany.mockResolvedValueOnce([]);
    expect(await run(A.createProgramAdjustmentAction, { user: "nobody", amount: "5", reason: "r", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" })).toContain("No user");
  });

  it("refuses an email that belongs to both a regular and an affiliate account", async () => {
    db.prisma.user.findMany.mockResolvedValueOnce([{ id: "u1" }, { id: "a1" }]);
    const url = await run(A.createProgramAdjustmentAction, { user: "same@x.com", amount: "5", reason: "r", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" });
    expect(new URL(url, "http://x").searchParams.get("error")).toContain("more than one account");
    expect(db.createProgramAdjustment).not.toHaveBeenCalled();
  });

  it("shows a db refusal as an error, and rethrows anything else", async () => {
    db.createProgramAdjustment.mockRejectedValueOnce(new db.ProgramActionRefused("insufficient_funds"));
    db.prisma.user.findMany.mockResolvedValueOnce([{ id: "u9" }]);
    expect(await run(A.createProgramAdjustmentAction, { user: "u9", amount: "-5", reason: "r", idempotencyKey: "9b2f1c3e-7a4d-4e8b-9c1a-2b3c4d5e6f70" })).toContain("Not enough available balance");

    db.approveProgramWithdrawal.mockRejectedValueOnce(new Error("db down"));
    await expect(A.approveProgramWithdrawalAction(form({ withdrawalId: "w1" }))).rejects.toThrow("db down");
  });
});
