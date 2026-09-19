import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "./admin-session";

/**
 * Page-level guard for the admin console. Server actions re-check the session
 * themselves (each is its own POST entrypoint); this covers page reads.
 */
export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");
}
