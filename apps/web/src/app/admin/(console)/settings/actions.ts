"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { setKycRequired } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

const ADMIN_ACTOR = "admin-panel";

export async function setKycRequiredAction(formData: FormData): Promise<void> {
  const store = await cookies();
  if (!(await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value))) throw new Error("Not authorised.");

  const value = formData.get("kycRequired");
  if (value !== "true" && value !== "false") return;
  await setKycRequired(value === "true", ADMIN_ACTOR);

  revalidatePath("/admin/settings");
}
