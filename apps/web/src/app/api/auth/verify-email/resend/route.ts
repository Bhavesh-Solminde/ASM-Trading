import { NextResponse, type NextRequest } from "next/server";
import { EMAIL_VERIFICATION_TTL_MS, findUserById, issueEmailVerificationToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendVerifyEmail } from "@asm/mail";
import { personName } from "@asm/mail/templates";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { getSession, rateLimited, unauthenticated } from "@/lib/request-session";
import { absoluteUrl } from "@/lib/site";

// Same reply whether or not a link went out (already verified, not an affiliate).
const SENT = { ok: true, message: "If your email still needs verifying, we've sent a new link. Check your inbox." };

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) return unauthenticated();

  const okIp = await checkRateLimit(`rl:verify-resend:ip:${ctx.ip}`, 10, 900);
  const okUser = await checkRateLimit(`rl:verify-resend:user:${session.userId}`, 3, 3600);
  if (!okIp || !okUser) {
    log.warn({ evt: "security.rate_limited", route: "verify_email_resend" }, "verification resend throttled");
    return rateLimited("Too many requests. Wait a while and try again.");
  }

  const user = await findUserById(session.userId);
  if (!user || user.role !== "AFFILIATE" || user.legacySimulated || user.emailVerified) {
    log.info({ evt: "auth.email_verify_resend_skipped", userId: session.userId }, "nothing to resend");
    return NextResponse.json(SENT);
  }

  const issued = await issueEmailVerificationToken(user.id);
  void sendVerifyEmail({
    to: user.email,
    cid: ctx.cid,
    tokenId: issued.id,
    name: personName(user),
    verifyUrl: absoluteUrl(`/api/auth/verify-email?token=${issued.token}`),
    ttlHours: EMAIL_VERIFICATION_TTL_MS / 3_600_000,
  });
  log.info({ evt: "auth.email_verify_resent", userId: user.id }, "verification link re-sent");
  return NextResponse.json(SENT);
}
