import { randomBytes } from "node:crypto";
import { bonusPercentForDeposit, findOrCreateGoogleUser, updateUserLastSeen } from "@asm/db";
import type { childLogger } from "@asm/logger";
import { sendWelcomeEmail } from "@asm/mail";
import type { GoogleProfile } from "./google-oauth";
import { hashPassword } from "./password";
import type { RequestContext } from "./request-context";
import { provisionNewUser } from "./signup";

type Logger = ReturnType<typeof childLogger>;

/**
 * Signs in, links, or creates the account for a verified Google identity.
 * Shared by the web OAuth callback and the native app route so both apply the
 * same linking rules, welcome email and provisioning.
 */
export async function signInWithGoogleProfile(
  profile: GoogleProfile,
  ctx: RequestContext,
  log: Logger,
): Promise<{ userId: string; created: boolean }> {
  const result = await findOrCreateGoogleUser({
    sub: profile.sub,
    email: profile.email,
    firstName: profile.givenName,
    lastName: profile.familyName,
    passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
  });

  if (result.created) {
    await provisionNewUser(result.userId, ctx);
    log.info({ evt: "auth.register", userId: result.userId, via: "google" }, "account created");
    void sendWelcomeEmail({
      to: profile.email,
      cid: ctx.cid,
      userId: result.userId,
      name: profile.givenName || null,
      firstDepositBonusPercent: bonusPercentForDeposit(1),
    });
  } else {
    updateUserLastSeen({ userId: result.userId, ip: ctx.ip, userAgent: ctx.userAgent }).catch(() => {
      /* best-effort, as on the password login route */
    });
    log.info({ evt: "auth.login", userId: result.userId, via: "google" }, "login succeeded");
  }
  return { userId: result.userId, created: result.created };
}
