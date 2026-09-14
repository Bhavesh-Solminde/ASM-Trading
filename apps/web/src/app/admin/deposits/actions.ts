"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { creditDepositToAccount, rejectDeposit } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

// The panel is gated by a single shared secret, not a user role (see
// admin-session). Server actions are their own POST entrypoints, so each one
// re-checks the admin session rather than trusting the page that rendered it.
const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/**
 * Approves a pending deposit that the feed never credited. creditId is null —
 * there is no bank credit to consume, so this is the operator vouching for a
 * payment out of band. creditDepositToAccount is idempotent via its status
 * guard, so a double submit credits at most once.
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
  revalidatePath("/admin/deposits");
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
  revalidatePath("/admin/deposits");
}
