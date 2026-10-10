import { NextResponse, type NextRequest } from "next/server";
import { PasswordResetConfirmSchema } from "@asm/contracts";
import { resetPasswordWithToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendPasswordChangedEmail } from "@asm/mail";
import { personName } from "@asm/mail/templates";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE } from "@/lib/session";

const INVALID_LINK = "This reset link is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  if (!(await checkRateLimit(`rl:pwreset-confirm:ip:${ctx.ip}`, 10, 900))) {
    log.warn({ evt: "security.rate_limited", route: "password_reset_confirm" }, "password reset confirm throttled");
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  const parsed = PasswordResetConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // A weak password gets its own message; any other problem reads as a bad link.
    const issue = parsed.error.issues[0];
    const error = issue?.path[0] === "password" ? issue.message : INVALID_LINK;
    return NextResponse.json({ error }, { status: 400 });
  }

  // Hash before touching the token, so a bad link costs the same as a good one.
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await resetPasswordWithToken({ token: parsed.data.token, passwordHash, ipAddress: ctx.ip });
  if (!user) {
    log.info({ evt: "auth.password_reset_failed" }, "reset link invalid, used or expired");
    return NextResponse.json({ error: INVALID_LINK }, { status: 400 });
  }

  log.info({ evt: "auth.password_reset", userId: user.userId }, "password reset via email link");
  void sendPasswordChangedEmail({
    to: user.email,
    cid: ctx.cid,
    userId: user.userId,
    name: personName(user),
    changedAt: new Date(),
  });

  const response = NextResponse.json({ ok: true });
  // Every session was just deleted; drop this browser's stale cookie too.
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
