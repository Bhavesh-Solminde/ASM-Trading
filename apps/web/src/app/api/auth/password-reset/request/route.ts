import { NextResponse, type NextRequest } from "next/server";
import { PasswordResetRequestSchema } from "@asm/contracts";
import { PASSWORD_RESET_TTL_MS, findUserByEmail, issuePasswordResetToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendPasswordResetEmail } from "@asm/mail";
import { displayName } from "@asm/mail/templates";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { absoluteUrl } from "@/lib/site";

// The same answer whether or not the email has an account, so this route
// can't be used to find out who is registered.
const SENT = {
  ok: true,
  message: "If that email has an account, we've sent a reset link. Check your inbox.",
};

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const parsed = PasswordResetRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const { email } = parsed.data;

  // Per IP and per address: one alone lets a bot spray resets or flood one inbox.
  const okIp = await checkRateLimit(`rl:pwreset:ip:${ctx.ip}`, 10, 900);
  const okEmail = await checkRateLimit(`rl:pwreset:email:${email}`, 3, 3600);
  if (!okIp || !okEmail) {
    log.warn({ evt: "security.rate_limited", route: "password_reset" }, "password reset throttled");
    return NextResponse.json({ error: "Too many reset requests. Wait a while and try again." }, { status: 429 });
  }

  const user = await findUserByEmail(email);

  // Same VPN rule as login. Looked up first so a vpnExempt account is recognised.
  const guardInput = user
    ? { ip: ctx.ip, route: "password_reset", log, userId: user.id }
    : { ip: ctx.ip, route: "password_reset", log };
  if ((await checkNetwork(guardInput)).blocked) {
    return vpnBlockedResponse();
  }

  // Affiliate and admin accounts are managed from the admin panel, which has
  // its own reset. Only regular users reset by email.
  if (!user || user.role !== "USER") {
    log.info({ evt: "auth.password_reset_requested", found: false }, "reset requested for an unknown or managed email");
    return NextResponse.json(SENT);
  }

  const issued = await issuePasswordResetToken({ userId: user.id, ipAddress: ctx.ip });
  // Not awaited: the reply must not get slower when the account exists.
  void sendPasswordResetEmail({
    to: user.email,
    cid: ctx.cid,
    tokenId: issued.id,
    name: displayName(user),
    resetUrl: absoluteUrl(`/reset-password?token=${issued.token}`),
    ttlMinutes: PASSWORD_RESET_TTL_MS / 60_000,
  });
  log.info({ evt: "auth.password_reset_requested", userId: user.id }, "password reset link issued");
  return NextResponse.json(SENT);
}
