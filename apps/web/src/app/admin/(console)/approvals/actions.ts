"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { approveWithdrawal, creditDepositToAccount, rejectDeposit } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

// The panel is gated by a single shared secret, not a user role. Each server
// action is its own POST entrypoint, so it re-checks the admin session.
const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/**
 * Approves a pending deposit the feed never credited. creditId is null — the
 * operator is vouching for the payment out of band. creditDepositToAccount is
 * idempotent via its status guard, so a double submit credits at most once.
 */
export async function approveDepositAction(formData: FormData): Promise<void> {
  await requirePanel();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;

  await creditDepositToAccount({ depositId, adminId: ADMIN_ACTOR, creditId: null });
  logger.info(
    { evt: "admin.action", action: "deposit.approve", depositId },
    "deposit approved by admin",
  );
  revalidatePath("/admin/approvals");
}

export async function rejectDepositAction(formData: FormData): Promise<void> {
  await requirePanel();
  const depositId = String(formData.get("depositId") ?? "");
  const reason = String(formData.get("reason") ?? "no matching credit");
  if (!depositId) return;

  await rejectDeposit({ depositId, adminId: ADMIN_ACTOR, reason });
  logger.info(
    { evt: "admin.action", action: "deposit.reject", depositId, reason },
    "deposit rejected by admin",
  );
  revalidatePath("/admin/approvals");
}

/**
 * Approves a requested withdrawal. approveWithdrawal is guarded to the
 * REQUESTED state and writes its own audit entry, so it is safe to call and
 * idempotent against a double submit.
 */
export async function approveWithdrawalAction(formData: FormData): Promise<void> {
  await requirePanel();
  const withdrawalId = String(formData.get("withdrawalId") ?? "");
  if (!withdrawalId) return;

  await approveWithdrawal({ withdrawalId, adminId: ADMIN_ACTOR });
  logger.info(
    { evt: "admin.action", action: "withdrawal.approve", withdrawalId },
    "withdrawal approved by admin",
  );
  revalidatePath("/admin/approvals");
}
