import { z } from "zod";
import { useLock } from "@/lock/lock-store";
import { useSession } from "./session-store";

/** What `/api/auth/login` and `/api/auth/register` return. */
export const TokenResult = z.object({ token: z.string(), userId: z.string() });

/**
 * Stores the session token. The root gatekeeper does the routing (lock setup, or the app) so there is a
 * single navigation owner. The cold-start lock guarded the previous session, so it is cleared first:
 * a user who just typed their password is not asked to unlock. A lock set up by a different user on this
 * phone is wiped, so this user is offered their own.
 */
export async function finishSignIn(token: string, userId: string): Promise<void> {
  await useLock.getState().startFreshSession(userId);
  await useSession.getState().signIn(token);
}
