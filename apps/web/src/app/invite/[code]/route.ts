import { NextResponse, type NextRequest } from "next/server";
import { normaliseReferralCode, resolveInvitationCode } from "@asm/db";
import { childLogger } from "@asm/logger";
import { appOrigin } from "@/lib/google-oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_OPTIONS } from "@/lib/referral";
import { requestContext } from "@/lib/request-context";

/**
 * Invitation link: remembers a valid code in `asm_ref` and always lands on
 * /register. An invalid (or throttled) link never overwrites an earlier valid
 * cookie, and the response is the same either way, so codes can't be probed here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const ctx = requestContext(req);
  const response = NextResponse.redirect(new URL("/register", appOrigin(req.nextUrl.origin)), 303);

  if (!(await checkRateLimit(`rl:invite:ip:${ctx.ip}`, 30, 300))) {
    childLogger(ctx.cid).warn({ evt: "security.rate_limited", route: "invite" }, "invite throttled");
    return response;
  }

  const code = normaliseReferralCode((await params).code);
  if (code && (await resolveInvitationCode(code))) {
    response.cookies.set(REFERRAL_COOKIE, code, REFERRAL_COOKIE_OPTIONS);
  }
  return response;
}
