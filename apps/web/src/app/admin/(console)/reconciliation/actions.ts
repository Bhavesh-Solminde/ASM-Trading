"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { runUsdtReconciliation } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/**
 * Forces an immediate USDT reconciliation pass (the engine also runs this on
 * its own interval). Read-only checks, write-only to ReconciliationIssue —
 * never touches a Deposit, Account, Transaction, or ChainCredit. Same-page
 * revalidation is enough here; there is no result banner to show.
 */
export async function runReconciliationNowAction(): Promise<void> {
  await requirePanel();
  await runUsdtReconciliation();
  revalidatePath("/admin/reconciliation");
  revalidatePath("/admin");
}
