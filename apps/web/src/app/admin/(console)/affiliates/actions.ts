"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AffiliateCreationRefused,
  createAffiliate,
  deleteAffiliateById,
  resetAffiliatePasswordById,
} from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { hashPassword } from "@/lib/password";

async function requirePanel(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) throw new Error("Not authorised.");
}

/** Admin "Create affiliate" POST handler. On error redirects back to the
 *  form with `?error=<msg>` set so the page can render it inline without a
 *  client component. */
export async function createAffiliateAction(formData: FormData): Promise<void> {
  await requirePanel();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nickname = String(formData.get("nickname") ?? "").trim() || null;

  if (!email || !email.includes("@")) {
    redirect("/admin/affiliates/new?error=" + encodeURIComponent("Enter a valid email address."));
  }
  if (password.length < 8) {
    redirect("/admin/affiliates/new?error=" + encodeURIComponent("Password must be at least 8 characters."));
  }

  try {
    const { user } = await createAffiliate({
      email,
      passwordHash: await hashPassword(password),
      nickname,
    });
    logger.info(
      { evt: "admin.action", action: "affiliate.created", userId: user.id, email },
      "affiliate created",
    );
  } catch (err) {
    if (err instanceof AffiliateCreationRefused) {
      redirect("/admin/affiliates/new?error=" + encodeURIComponent(err.message));
    }
    throw err;
  }

  revalidatePath("/admin/affiliates");
  redirect("/admin/affiliates");
}

/** "Reset password" row-action. Admin types a new password; it's hashed
 *  with argon2 (the same path as create / login verify) and persisted.
 *  Audited as `affiliate.password_reset`. */
export async function resetAffiliatePasswordAction(formData: FormData): Promise<void> {
  await requirePanel();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId) return;
  if (password.length < 8) {
    redirect(
      "/admin/affiliates?error=" +
        encodeURIComponent("New password must be at least 8 characters."),
    );
  }

  try {
    await resetAffiliatePasswordById({
      userId,
      passwordHash: await hashPassword(password),
    });
    logger.info(
      { evt: "admin.action", action: "affiliate.password_reset", userId },
      "affiliate password reset",
    );
  } catch (err) {
    if (err instanceof AffiliateCreationRefused) {
      redirect("/admin/affiliates?error=" + encodeURIComponent(err.message));
    }
    throw err;
  }

  revalidatePath("/admin/affiliates");
  redirect("/admin/affiliates?reset=1");
}

/** Delete button on the list row. One-shot action — the browser form submit
 *  is the only confirmation, mirroring other destructive admin actions. */
export async function deleteAffiliateAction(formData: FormData): Promise<void> {
  await requirePanel();

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;

  try {
    await deleteAffiliateById(userId);
    logger.info(
      { evt: "admin.action", action: "affiliate.deleted", userId },
      "affiliate deleted",
    );
  } catch (err) {
    if (err instanceof AffiliateCreationRefused) {
      logger.warn(
        { evt: "admin.action_refused", action: "affiliate.deleted", userId, reason: err.message },
        "affiliate delete refused",
      );
    } else {
      throw err;
    }
  }

  revalidatePath("/admin/affiliates");
}
