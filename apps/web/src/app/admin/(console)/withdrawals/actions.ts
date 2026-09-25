"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { approveWithdrawal } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
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
  revalidatePath("/admin/withdrawals");
  revalidatePath("/admin");
}
