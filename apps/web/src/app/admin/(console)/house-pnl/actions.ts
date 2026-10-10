"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  houseDateForInstant,
  setTreasuryTarget,
  upsertHouseDayTarget,
} from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

async function assertAdmin() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");
}

/**
 * Sets today's house target in whole rupees. Stored in paise. Called from the
 * admin house-pnl form.
 */
export async function setTargetAction(formData: FormData) {
  await assertAdmin();
  const rupees = Number(formData.get("targetRupees"));
  if (!Number.isFinite(rupees) || rupees < 0) return;
  await upsertHouseDayTarget({
    date: houseDateForInstant(new Date()),
    targetProfitMinor: Math.round(rupees * 100),
  });
  revalidatePath("/admin/house-pnl");
}

/**
 * Sets the GLG treasury target in whole rupees. Health = treasury / target
 * feeds the pWin ladder, so this is the live knob that steers user win
 * probability. Must be > 0 to keep the ladder well-defined.
 */
export async function setTreasuryTargetAction(formData: FormData) {
  await assertAdmin();
  const rupees = Number(formData.get("treasuryTargetRupees"));
  if (!Number.isFinite(rupees) || rupees <= 0) return;
  await setTreasuryTarget(Math.round(rupees * 100));
  revalidatePath("/admin/house-pnl");
}
