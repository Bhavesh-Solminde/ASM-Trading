import { prisma } from "../client";
import type { LifecycleStage } from "../../generated/prisma/enums";

/**
 * Overrides the automatically-derived lifecycle stage for a single account,
 * or clears the override when `stage` is null. Used by the admin win-rate
 * console to force a specific stage while investigating.
 */
export async function setLifecycleOverride(
  accountId: string,
  stage: LifecycleStage | null,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: { lifecycleOverride: stage },
  });
}
