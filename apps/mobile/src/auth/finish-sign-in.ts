import { z } from "zod";
import { useLock } from "@/lock/lock-store";
import { useSession } from "./session-store";

/** What `/api/auth/login` and `/api/auth/register` return. */
export const TokenResult = z.object({ token: z.string(), userId: z.string() });

/**
 * Stores the session token. The root gatekeeper does the routing (lock setup, or the app) so there is a
 * single navigation owner. The cold-start lock guarded the previous session, so it is cleared first:
 * a user who just typed their password is not asked to unlock.
 */
export async function finishSignIn(token: string): Promise<void> {
  useLock.getState().startFreshSession();
  await useSession.getState().signIn(token);
}
