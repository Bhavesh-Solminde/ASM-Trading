"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ProgramSettingKey,
  ProgramActionRefused,
  appendAffiliateRate,
  appendProgramSetting,
  approveProgramWithdrawal,
  clearNeedsReview,
  createProgramAdjustment,
  markProgramWithdrawalPaid,
  prisma,
  rejectProgramWithdrawal,
  releaseHeldEarning,
  setAffiliateStatus,
  voidHeldEarning,
} from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { parseIstDateTime, percentToBps, rupeesToPaise, settingValueFromInput } from "./parse";

const ADMIN_ACTOR = "admin-panel";
const PATH = "/admin/affiliate-program";
const TEXT_MAX = 500;
const AFFILIATE_TARGETS = new Set(["ACTIVE", "SUSPENDED"]);

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim().slice(0, TEXT_MAX) : "";
}

const REFUSED: Record<string, string> = {
  insufficient_funds: "Not enough available balance for that.",
  invalid_amount: "Enter a valid non-zero amount.",
  invalid_state: "That record has already moved on. Refresh and try again.",
  not_found: "That record no longer exists.",
  affiliate_not_active: "The affiliate is not active.",
  account_frozen: "The account is frozen or banned.",
  kyc_required: "KYC must be verified first.",
};

function back(to: string, key: "ok" | "error", value: string): never {
  redirect(`${to}${to.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`);
}

/** Runs a db call; a business refusal comes back to the page as `?error=`, anything else is a real failure. */
async function attempt(to: string, action: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ProgramActionRefused || (err instanceof Error && err.name === "ProgramActionRefused")) {
      const code = (err as ProgramActionRefused).code;
      logger.warn({ evt: "admin.action_refused", action, code }, "program admin action refused");
      back(to, "error", REFUSED[code] ?? err.message);
    }
    throw err;
  }
  logger.info({ evt: "admin.action", action }, "program admin action");
  revalidatePath(PATH, "layout");
}

const tab = (t: string) => `${PATH}?tab=${t}`;
const affiliatePage = (id: string) => `${PATH}/affiliates/${encodeURIComponent(id)}`;

/* -------------------------------- Settings -------------------------------- */

export async function scheduleSettingAction(formData: FormData): Promise<void> {
  await requirePanel();
  const to = tab("settings");
  const key = text(formData, "key");
  const reason = text(formData, "reason");
  if (!(Object.values(ProgramSettingKey) as string[]).includes(key)) back(to, "error", "Pick a setting.");
  const value = settingValueFromInput(key, text(formData, "value"));
  if (value === null) back(to, "error", "Enter a valid value in the units shown.");
  const effectiveFrom = parseIstDateTime(text(formData, "effectiveFrom"), new Date());
  if (!effectiveFrom) back(to, "error", "Enter a valid effective date and time.");
  if (!reason) back(to, "error", "A reason is required.");

  await attempt(to, "program.setting_changed", () =>
    appendProgramSetting({ key: key as ProgramSettingKey, value, effectiveFrom, reason, actor: ADMIN_ACTOR }),
  );
  back(to, "ok", "Setting scheduled.");
}

/* ------------------------------- Affiliates ------------------------------- */

/** Approve (PENDING_APPROVAL → ACTIVE), suspend, or reinstate (SUSPENDED → ACTIVE). */
export async function setAffiliateStatusAction(formData: FormData): Promise<void> {
  await requirePanel();
  const userId = text(formData, "userId");
  const status = text(formData, "status");
  const reason = text(formData, "reason");
  if (!userId) back(tab("affiliates"), "error", "Missing affiliate.");
  const to = affiliatePage(userId);
  if (!AFFILIATE_TARGETS.has(status)) back(to, "error", "Pick a status.");
  if (!reason) back(to, "error", "A reason is required.");

  await attempt(to, "affiliate.status_changed", () =>
    setAffiliateStatus({ userId, status: status as "ACTIVE" | "SUSPENDED", reason, actor: ADMIN_ACTOR }),
  );
  back(to, "ok", status === "SUSPENDED" ? "Affiliate suspended." : "Affiliate is active.");
}

export async function assignAffiliateRateAction(formData: FormData): Promise<void> {
  await requirePanel();
  const affiliateId = text(formData, "affiliateId");
  if (!affiliateId) back(tab("affiliates"), "error", "Missing affiliate.");
  const to = affiliatePage(affiliateId);
  const revenueShareBps = percentToBps(text(formData, "revenueSharePct"));
  if (revenueShareBps === null) back(to, "error", "Revenue Share must be a percentage from 0 to 100.");
  const depositRaw = text(formData, "depositRewardPct");
  const depositRewardBps = depositRaw ? percentToBps(depositRaw) : null;
  if (depositRaw && depositRewardBps === null) back(to, "error", "Deposit reward must be a percentage from 0 to 100, or empty.");
  const effectiveFrom = parseIstDateTime(text(formData, "effectiveFrom"), new Date());
  if (!effectiveFrom) back(to, "error", "Enter a valid effective date and time.");
  const reason = text(formData, "reason");
  if (!reason) back(to, "error", "A reason is required.");

  await attempt(to, "affiliate.rate_assigned", () =>
    appendAffiliateRate({ affiliateId, revenueShareBps, depositRewardBps, effectiveFrom, reason, actor: ADMIN_ACTOR }),
  );
  back(to, "ok", "Rate assigned.");
}

/* ------------------------------- Withdrawals ------------------------------ */

export async function approveProgramWithdrawalAction(formData: FormData): Promise<void> {
  await requirePanel();
  const id = text(formData, "withdrawalId");
  const to = tab("withdrawals");
  if (!id) back(to, "error", "Missing withdrawal.");
  const note = text(formData, "note");
  await attempt(to, "program.withdrawal.approve", () =>
    approveProgramWithdrawal({ id, actor: ADMIN_ACTOR, ...(note ? { note } : {}) }),
  );
  back(to, "ok", "Withdrawal approved. Pay it, then mark it paid.");
}

export async function rejectProgramWithdrawalAction(formData: FormData): Promise<void> {
  await requirePanel();
  const id = text(formData, "withdrawalId");
  const reason = text(formData, "reason");
  const to = tab("withdrawals");
  if (!id) back(to, "error", "Missing withdrawal.");
  if (!reason) back(to, "error", "A reason is required; the user sees it.");
  await attempt(to, "program.withdrawal.reject", () => rejectProgramWithdrawal({ id, actor: ADMIN_ACTOR, reason }));
  back(to, "ok", "Withdrawal rejected; the amount is back in the user's available balance.");
}

export async function markProgramWithdrawalPaidAction(formData: FormData): Promise<void> {
  await requirePanel();
  const id = text(formData, "withdrawalId");
  const paymentReference = text(formData, "paymentReference");
  const to = tab("withdrawals");
  if (!id) back(to, "error", "Missing withdrawal.");
  if (!paymentReference) back(to, "error", "A payment reference is required.");
  await attempt(to, "program.withdrawal.paid", () =>
    markProgramWithdrawalPaid({ id, actor: ADMIN_ACTOR, paymentReference }),
  );
  back(to, "ok", "Withdrawal marked paid.");
}

/* ----------------------------- Earnings review ---------------------------- */

export async function releaseHeldEarningAction(formData: FormData): Promise<void> {
  await requirePanel();
  const earningId = text(formData, "earningId");
  const note = text(formData, "note");
  const to = tab("review");
  if (!earningId) back(to, "error", "Missing earning.");
  if (!note) back(to, "error", "A note is required.");
  await attempt(to, "program.earning_released", () => releaseHeldEarning({ earningId, actor: ADMIN_ACTOR, note }));
  back(to, "ok", "Earning released; it becomes available at the next daily close.");
}

export async function voidHeldEarningAction(formData: FormData): Promise<void> {
  await requirePanel();
  const earningId = text(formData, "earningId");
  const reason = text(formData, "reason");
  const to = tab("review");
  if (!earningId) back(to, "error", "Missing earning.");
  if (!reason) back(to, "error", "A reason is required.");
  await attempt(to, "program.earning_voided", () => voidHeldEarning({ earningId, actor: ADMIN_ACTOR, reason }));
  back(to, "ok", "Earning voided.");
}

export async function clearNeedsReviewAction(formData: FormData): Promise<void> {
  await requirePanel();
  const earningId = text(formData, "earningId");
  const note = text(formData, "note");
  const to = `${tab("review")}&filter=NEEDS_REVIEW`;
  if (!earningId) back(to, "error", "Missing earning.");
  if (!note) back(to, "error", "A note is required.");
  await attempt(to, "program.earning_review_cleared", () => clearNeedsReview({ earningId, actor: ADMIN_ACTOR, note }));
  back(to, "ok", "Review flag cleared.");
}

/** Manual ± adjustment by user id or email. A negative amount is refused below 0 available. */
export async function createProgramAdjustmentAction(formData: FormData): Promise<void> {
  await requirePanel();
  const to = tab("review");
  const who = text(formData, "user");
  const amountMinor = rupeesToPaise(text(formData, "amount"), { signed: true });
  const reason = text(formData, "reason");
  // One key per rendered form, so a double submit records the adjustment once.
  const idempotencyKey = text(formData, "idempotencyKey");
  if (!idempotencyKey) back(to, "error", "This form expired. Reload the page and try again.");
  if (!who) back(to, "error", "Enter a user ID or email.");
  if (amountMinor === null || amountMinor === 0) back(to, "error", "Enter a non-zero amount in rupees, e.g. 250 or -99.50.");
  if (!reason) back(to, "error", "A reason is required.");

  // One email can hold a regular and an affiliate account, so an email must match exactly one.
  const matches = await prisma.user.findMany({
    where: { OR: [{ id: who }, { email: { equals: who, mode: "insensitive" } }] },
    select: { id: true },
    take: 2,
  });
  if (matches.length > 1) back(to, "error", "That email has more than one account. Enter the user ID instead.");
  const user = matches[0];
  if (!user) back(to, "error", "No user with that ID or email.");

  await attempt(to, "program.adjustment", () =>
    createProgramAdjustment({ userId: user.id, amountMinor, reason, actor: ADMIN_ACTOR, idempotencyKey }),
  );
  back(to, "ok", "Adjustment recorded.");
}
