import { z } from "zod";
import { clearResume, loadLastUserId } from "@/cache/resume-cache";
import { useLock } from "@/lock/lock-store";
import { useSession } from "./session-store";

/** What `/api/auth/login` and `/api/auth/register` return. */
export const TokenResult = z.object({ token: z.string(), userId: z.string() });

/**
 * Stores the session token. The root gatekeeper does the routing (lock setup, or the app) so there is a
 * single navigation owner. The cold-start lock guarded the previous session, so it is cleared first:
 * a user who just typed their password is not asked to unlock. A lock set up by a different user on this
 * phone is wiped, so this user is offered their own. The same goes for the cached balance snapshot and open
 * trades: if a different user is remembered (their sign-out never ran, e.g. the keystore was unreadable on a
 * cold start), the cache is wiped here, because sign-in is the one place that knows the real `userId`. That also
 * stops the Trade screen from routing this user's pref writes into the remembered user's slot before bootstrap.
 */
export async function finishSignIn(token: string, userId: string): Promise<void> {
  const remembered = loadLastUserId();
  if (remembered !== null && remembered !== userId) clearResume();
  await useLock.getState().startFreshSession(userId);
  await useSession.getState().signIn(token);
}
