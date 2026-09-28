"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { houseDateForInstant, upsertHouseDayTarget } from "@asm/db";
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
