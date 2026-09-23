"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  reviewFraudFlag,
  setUserStatus,
  UserStatus,
  prisma,
} from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

// Same shape as the sibling actions files — one shared secret in cookies, no
// per-user role check, every action re-verifies before touching the DB.
const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/** DISMISS a flag: a household on shared WiFi, an office IP, a false positive.
 *  Users stay ACTIVE — nothing else moves. */
export async function dismissFlagAction(formData: FormData): Promise<void> {
  await requirePanel();
  const flagId = String(formData.get("flagId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  if (!flagId) return;

  await reviewFraudFlag({
    flagId,
    adminId: ADMIN_ACTOR,
    verdict: "DISMISSED",
    ...(note && { note }),
  });
  logger.info({ evt: "admin.action", action: "fraud.dismiss", flagId }, "flag dismissed");
  revalidatePath("/admin/fraud");
}

/**
 * CONFIRM the flag AND freeze every linked user in one shot. Freezing (as
 * opposed to banning) preserves the audit trail and the balance, blocks new
 * trades/deposits/withdrawals via `User.status !== 'ACTIVE'` gates, and lets
 * a human decide later whether to unfreeze, ban, or return funds. This is
 * the default punitive action.
 */
export async function confirmAndFreezeAction(formData: FormData): Promise<void> {
  await requirePanel();
  const flagId = String(formData.get("flagId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  if (!flagId) return;

  const flag = await prisma.fraudFlag.findUnique({
    where: { id: flagId },
    select: { linkedUserIds: true },
  });
  if (!flag) return;

  await reviewFraudFlag({
    flagId,
    adminId: ADMIN_ACTOR,
    verdict: "CONFIRMED",
    ...(note && { note }),
  });

  const reason = note || "Confirmed multi-account linkage";
  for (const uid of flag.linkedUserIds) {
    await setUserStatus({
      userId: uid,
      status: UserStatus.FROZEN,
      reason,
      adminId: ADMIN_ACTOR,
    });
  }

  logger.info(
    {
      evt: "admin.action",
      action: "fraud.confirm_freeze",
      flagId,
      users: flag.linkedUserIds.length,
    },
    "fraud flag confirmed, users frozen",
  );
  revalidatePath("/admin/fraud");
}

/**
 * CONFIRM and hard-BAN every linked user. Use for confirmed abuse cases
 * where the operator is not planning to return funds. Ban is irreversible
 * from the admin's standpoint — only a direct DB edit rehabilitates.
 */
export async function confirmAndBanAction(formData: FormData): Promise<void> {
  await requirePanel();
  const flagId = String(formData.get("flagId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  if (!flagId) return;

  const flag = await prisma.fraudFlag.findUnique({
    where: { id: flagId },
    select: { linkedUserIds: true },
  });
  if (!flag) return;

  await reviewFraudFlag({
    flagId,
    adminId: ADMIN_ACTOR,
    verdict: "CONFIRMED",
    ...(note && { note }),
  });

  const reason = note || "Confirmed multi-account abuse";
  for (const uid of flag.linkedUserIds) {
    await setUserStatus({
      userId: uid,
      status: UserStatus.BANNED,
      reason,
      adminId: ADMIN_ACTOR,
    });
  }

  logger.info(
    {
      evt: "admin.action",
      action: "fraud.confirm_ban",
      flagId,
      users: flag.linkedUserIds.length,
    },
    "fraud flag confirmed, users banned",
  );
  revalidatePath("/admin/fraud");
}

/**
 * Rehabilitates a single user back to ACTIVE. Used to unfreeze a false
 * positive after a resolved flag, or to overturn a mistaken freeze. Never
 * touches balances — only the status column.
 */
export async function unfreezeUserAction(formData: FormData): Promise<void> {
  await requirePanel();
  const userId = String(formData.get("userId") ?? "");
  const note = String(formData.get("note") ?? "manual reactivation").slice(0, 500);
  if (!userId) return;

  await setUserStatus({
    userId,
    status: UserStatus.ACTIVE,
    reason: note,
    adminId: ADMIN_ACTOR,
  });
  logger.info(
    { evt: "admin.action", action: "user.unfreeze", userId },
    "user status returned to ACTIVE",
  );
  revalidatePath("/admin/fraud");
}
