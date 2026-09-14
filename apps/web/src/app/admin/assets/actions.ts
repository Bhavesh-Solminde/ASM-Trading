"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

// The panel is gated by a shared secret, not a user role. Each server action is
// its own POST entrypoint, so it re-checks the admin session itself.
const ADMIN_ACTOR = "admin-panel";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/**
 * Edits the asset's payout only. Every open trade already stores the payout it
 * was opened at, so a change here can never alter an existing position's terms.
 */
export async function setAssetPayoutAction(formData: FormData): Promise<void> {
  await requirePanel();

  const assetId = String(formData.get("assetId") ?? "");
  const payoutPct = Number(formData.get("payoutPct"));

  if (!assetId || !Number.isInteger(payoutPct) || payoutPct < 1 || payoutPct > 200) {
    return;
  }

  const before = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { payoutPct: true, symbol: true },
  });
  if (!before) return;

  await prisma.asset.update({ where: { id: assetId }, data: { payoutPct } });

  await prisma.auditLog.create({
    data: {
      actorId: ADMIN_ACTOR,
      action: "asset.payout_changed",
      targetType: "Asset",
      targetId: assetId,
      before: { payoutPct: before.payoutPct },
      after: { payoutPct },
    },
  });

  logger.info(
    {
      evt: "admin.action",
      action: "asset.payout_changed",
      symbol: before.symbol,
      from: before.payoutPct,
      to: payoutPct,
    },
    "asset payout changed",
  );

  revalidatePath("/admin/assets");
}

export async function toggleAssetOpenAction(formData: FormData): Promise<void> {
  await requirePanel();
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) return;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { isOpen: true, symbol: true },
  });
  if (!asset) return;

  await prisma.asset.update({ where: { id: assetId }, data: { isOpen: !asset.isOpen } });

  await prisma.auditLog.create({
    data: {
      actorId: ADMIN_ACTOR,
      action: "asset.open_toggled",
      targetType: "Asset",
      targetId: assetId,
      before: { isOpen: asset.isOpen },
      after: { isOpen: !asset.isOpen },
    },
  });

  revalidatePath("/admin/assets");
}
