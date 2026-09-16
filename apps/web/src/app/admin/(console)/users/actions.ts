"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { KycStatus, Role, prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

const ADMIN_ACTOR = "admin-panel";

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
  if (!userId || !ROLES.has(role as Role) || !KYCS.has(kycStatus as KycStatus)) return;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, kycStatus: true, email: true },
  });
  if (!before) return;

  if (before.role !== role || before.kycStatus !== kycStatus) {
    await prisma.user.update({
      where: { id: userId },
      data: { role: role as Role, kycStatus: kycStatus as KycStatus },
    });
    await prisma.auditLog.create({
      data: {
        actorId: ADMIN_ACTOR,
        action: "user.updated",
        targetType: "User",
        targetId: userId,
        before: { role: before.role, kycStatus: before.kycStatus },
        after: { role, kycStatus },
      },
    });
    logger.info(
      { evt: "admin.action", action: "user.updated", email: before.email, role, kycStatus },
      "admin updated user",
    );
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}
