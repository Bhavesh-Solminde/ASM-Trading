"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { KycStatus, Role, UserStatus, prisma, setUserStatus } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { destroyAllSessionsForUser } from "@/lib/session";
import { engineCfdClose } from "@/lib/engine-client";
import {
  USER_STATUS_REASONS,
  formatStatusReason,
  type UserStatusReasonCode,
} from "../../_lib/user-status";

const ADMIN_ACTOR = "admin-panel";
const REASON_CODES = new Set<string>(USER_STATUS_REASONS.map((r) => r.code));
const STATUSES = new Set<string>(Object.values(UserStatus));
const RESTRICTIVE: Set<UserStatus> = new Set([UserStatus.FROZEN, UserStatus.BANNED]);

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

const ROLES = new Set(Object.values(Role));
const KYCS = new Set(Object.values(KycStatus));

/** Updates an account's role and KYC status. Both changes are audited. Balance
 *  and ledger data are never touched from here. */
export async function updateUserAction(formData: FormData): Promise<void> {
  await requirePanel();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  const kycStatus = String(formData.get("kycStatus") ?? "");
  const liveAccess = String(formData.get("liveAccess") ?? "") === "true";
  const vpnExempt = String(formData.get("vpnExempt") ?? "") === "true";
  if (!userId || !ROLES.has(role as Role) || !KYCS.has(kycStatus as KycStatus)) return;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, kycStatus: true, liveAccess: true, vpnExempt: true, email: true },
  });
  if (!before) return;

  if (
    before.role !== role ||
    before.kycStatus !== kycStatus ||
    before.liveAccess !== liveAccess ||
    before.vpnExempt !== vpnExempt
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: { role: role as Role, kycStatus: kycStatus as KycStatus, liveAccess, vpnExempt },
    });
    await prisma.auditLog.create({
      data: {
        actorId: ADMIN_ACTOR,
        action: "user.updated",
        targetType: "User",
        targetId: userId,
        before: {
          role: before.role,
          kycStatus: before.kycStatus,
          liveAccess: before.liveAccess,
          vpnExempt: before.vpnExempt,
        },
        after: { role, kycStatus, liveAccess, vpnExempt },
      },
    });
    logger.info(
      {
        evt: "admin.action",
        action: "user.updated",
        email: before.email,
        role,
        kycStatus,
        liveAccess,
        vpnExempt,
      },
      "admin updated user",
    );
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

/**
 * Changes a user's compliance status (ACTIVE / FLAGGED / FROZEN / BANNED) from
 * the per-user detail page. FROZEN and BANNED also close every open CFD
 * position at the current mark and sign the user out of every device; the
 * money-moving gates (new trades, withdrawals) are enforced downstream and
 * require no additional touch here.
 *
 * The single DB write + audit row is delegated to `setUserStatus`; this
 * action only decorates it with session destruction, position-closing, and
 * the destructive-action confirmation phrase for BAN.
 */
export async function setUserStatusAction(formData: FormData): Promise<void> {
  await requirePanel();

  const userId = String(formData.get("userId") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "");
  const reasonNote = String(formData.get("reasonNote") ?? "").slice(0, 500);
  const confirmPhrase = String(formData.get("confirmPhrase") ?? "");

  if (!userId || !STATUSES.has(nextStatus) || !REASON_CODES.has(reasonCode)) return;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, email: true },
  });
  if (!before) return;
  if (before.status === nextStatus) return;

  // Destructive-action gate: BAN requires the admin to type "BAN". Freeze and
  // the lighter statuses do not — Freeze is reversible and gets a sheet-level
  // confirm instead.
  if (nextStatus === UserStatus.BANNED && confirmPhrase.trim() !== "BAN") {
    throw new Error("Ban confirmation phrase did not match. Type BAN to confirm.");
  }

  const reason = formatStatusReason(reasonCode as UserStatusReasonCode, reasonNote);
  const typedNext = nextStatus as UserStatus;

  // Close any open CFD positions FIRST on a transition into FROZEN/BANNED so
  // the user cannot slip a modify/close through while the status flip is
  // in flight. The engine serializes per-account, so sequential suffices;
  // one trade failing to close must not block the status change — the
  // downstream gates will still refuse new trades and withdrawals.
  let closedCount = 0;
  let closeFailures = 0;
  if (RESTRICTIVE.has(typedNext)) {
    const openTrades = await prisma.trade.findMany({
      where: {
        status: "OPEN",
        durationSec: { not: null }, // CFD only; binary trades auto-settle on expiry
        account: { userId },
      },
      select: { id: true },
    });
    for (const t of openTrades) {
      try {
        await engineCfdClose(t.id);
        closedCount += 1;
      } catch (err) {
        closeFailures += 1;
        logger.warn(
          {
            evt: "admin.action.close_failed",
            userId,
            tradeId: t.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "failed to close trade during status change",
        );
      }
    }
  }

  await setUserStatus({
    userId,
    status: typedNext,
    reason,
    adminId: ADMIN_ACTOR,
  });

  if (RESTRICTIVE.has(typedNext)) {
    await destroyAllSessionsForUser(userId);
  }

  logger.info(
    {
      evt: "admin.action",
      action: `user.status.${nextStatus.toLowerCase()}`,
      email: before.email,
      from: before.status,
      to: nextStatus,
      reasonCode,
      closedPositions: closedCount,
      closeFailures,
    },
    "admin changed user status",
  );

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}
