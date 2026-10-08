"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { KycNotPending, reviewKyc } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { KYC_REJECT_REASONS } from "./reasons";

const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

async function decide(userId: string, decision: "VERIFIED" | "REJECTED", note: string | null) {
  try {
    await reviewKyc({ userId, decision, adminId: ADMIN_ACTOR, note });
  } catch (err) {
    // Another admin decided first — fall through to the refreshed page.
    if (!(err instanceof KycNotPending)) throw err;
  }
  logger.info({ evt: "admin.action", action: `kyc.${decision.toLowerCase()}`, userId }, "admin reviewed kyc");
  revalidatePath("/admin/kyc");
  revalidatePath(`/admin/kyc/${userId}`);
  revalidatePath(`/admin/users/${userId}`);
}

/** Approves a pending KYC submission: the user can withdraw from now on. */
export async function approveKycAction(formData: FormData): Promise<void> {
  await requirePanel();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await decide(userId, "VERIFIED", null);
  redirect("/admin/kyc");
}

/** Rejects a pending KYC submission with a reason the user sees; they can fix and resubmit. */
export async function rejectKycAction(formData: FormData): Promise<void> {
  await requirePanel();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  const preset = String(formData.get("reason") ?? "");
  const extra = String(formData.get("note") ?? "").trim().slice(0, 300);
  const base = (KYC_REJECT_REASONS as readonly string[]).includes(preset) ? preset : "";
  const note = [base, extra].filter(Boolean).join(" — ") || "Your documents couldn't be verified.";
  await decide(userId, "REJECTED", note);
  redirect("/admin/kyc");
}
