import { router } from "expo-router";
import { z } from "zod";
import { useLock } from "@/lock/lock-store";
import { useSession } from "./session-store";

/** What `/api/auth/login` and `/api/auth/register` return. */
export const TokenResult = z.object({ token: z.string(), userId: z.string() });

/**
 * Stores the session token, then sends the user to set up an app lock if this device has none yet.
 * The root layout loads the lock store at startup, so `method` is already known here.
 */
export async function finishSignIn(token: string): Promise<void> {
  await useSession.getState().signIn(token);
  router.replace(useLock.getState().method === null ? "/lock-setup" : "/");
}
