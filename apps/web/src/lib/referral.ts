import { attachReferralAtSignup } from "@asm/db";
import type { childLogger } from "@asm/logger";
import type { RequestContext } from "./request-context";

/** Last valid invitation link opened in this browser (normalised code). */
export const REFERRAL_COOKIE = "asm_ref";

export const REFERRAL_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 400 * 24 * 3600,
};

export const CLEAR_REFERRAL_COOKIE = { name: REFERRAL_COOKIE, value: "", path: "/", maxAge: 0 } as const;

/**
 * Attaches the inviter to a just-created user. Never throws: a referral
 * problem (bad code, DB hiccup) must not fail an otherwise good signup.
 */
export async function attachSignupReferral(
  input: { userId: string; code: string; via: "LINK" | "CODE" },
  ctx: RequestContext,
  log: ReturnType<typeof childLogger>,
): Promise<void> {
  try {
    const result = await attachReferralAtSignup({ ...input, ip: ctx.ip, userAgent: ctx.userAgent });
    const level = result.outcome === "attached" ? "info" : "warn";
    log[level]({ evt: "referral.attach", userId: input.userId, via: input.via, ...result }, "signup referral");
  } catch (err) {
    log.error({ evt: "referral.attach_failed", userId: input.userId, err }, "signup referral failed");
  }
}
