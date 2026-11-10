"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { requireAdmin } from "@/lib/admin-auth";

type TargetSaveState = { message: string; saved: boolean } | null;

export async function saveDailyTarget(
  _previousState: TargetSaveState,
  formData: FormData,
): Promise<TargetSaveState> {
  await requireAdmin();

  const amount = formData.get("targetRupees");
  const parts = typeof amount === "string" ? /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(amount.trim()) : null;
  const dailyTargetMinor = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : 0;
  if (dailyTargetMinor <= 0) {
    return { message: "Enter a positive amount in rupees with up to two decimal places and 12 digits before the decimal.", saved: false };
  }

  try {
    await prisma.$transaction([
      prisma.otcVaultSettings.upsert({
        where: { id: 1 },
        create: { id: 1, dailyTargetMinor },
        update: { dailyTargetMinor },
      }),
      prisma.auditLog.create({
        data: {
          actorId: "admin-panel",
          action: "otc_vault.daily_target_changed",
          targetType: "OtcVaultSettings",
          targetId: "1",
          after: { dailyTargetMinor },
        },
      }),
    ]);
  } catch (error) {
    logger.error({ err: error }, "Failed to save the OTC vault daily target");
    return { message: "Couldn’t save the target. Try again.", saved: false };
  }

  revalidatePath("/admin/house-pnl");
  return { message: "Daily target saved.", saved: true };
}
