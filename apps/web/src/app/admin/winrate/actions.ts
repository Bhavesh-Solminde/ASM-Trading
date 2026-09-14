"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, setLifecycleOverride, type LifecycleStage } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

async function assertAdmin() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");
}

export async function setOverrideAction(formData: FormData) {
  await assertAdmin();
  const accountId = formData.get("accountId") as string;
  const stage = formData.get("stage") as string;
  await setLifecycleOverride(
    accountId,
    stage === "" ? null : (stage as LifecycleStage),
  );
  revalidatePath("/admin/winrate");
}

export async function clearOverrideAction(formData: FormData) {
  await assertAdmin();
  const accountId = formData.get("accountId") as string;
  await setLifecycleOverride(accountId, null);
  revalidatePath("/admin/winrate");
}

/** Returns aggregate shadow stats for all accounts with settled trades. */
export async function getShadowStatsForAccount(accountId: string) {
  const rows = await prisma.tradeShadow.findMany({
    where: { trade: { accountId } },
    select: { shownResult: true, honestResult: true, deltaPips: true },
  });
  const total = rows.length;
  if (total === 0) return null;
  const shownWins = rows.filter((r) => r.shownResult === "WON").length;
  const honestWins = rows.filter((r) => r.honestResult === "WON").length;
  const avgDelta = rows.reduce((s, r) => s + r.deltaPips, 0) / total;
  return {
    total,
    shownRate: shownWins / total,
    honestRate: honestWins / total,
    avgDeltaPips: avgDelta,
  };
}
