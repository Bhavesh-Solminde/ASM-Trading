import { NextResponse, type NextRequest } from "next/server";
import { LoginSchema } from "@asm/contracts";
import { findUserByEmail, updateUserLastSeen } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { verifyPassword, hashPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

const GENERIC = "Email or password is incorrect.";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const body: unknown = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // Limit by IP and by account — one alone leaves a gap.
  const okIp = await checkRateLimit(`rl:login:ip:${ctx.ip}`, 20, 300);
  const okAccount = await checkRateLimit(`rl:login:acct:${email}`, 5, 300);
  if (!okIp || !okAccount) {
    log.warn({ evt: "security.rate_limited", route: "login" }, "login throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait five minutes and try again." },
      { status: 429 },
    );
  }

  const user = await findUserByEmail(email);

  // Network check runs BEFORE any credential verdict, so a VPN client gets the
  // same 403 whether the email is unknown, the password is wrong or both are
  // right — it cannot use this route as a password-validity oracle. It sits
  // after the user lookup so a vpnExempt account is still recognised. Two
  // input shapes because userId is omitted (not undefined) when no user exists.
  const guardInput = user
    ? { ip: ctx.ip, route: "login", log, userId: user.id }
    : { ip: ctx.ip, route: "login", log };
  if ((await checkNetwork(guardInput)).blocked) {
    return vpnBlockedResponse();
  }

  // Hash a dummy value on miss so response timing does not reveal whether the
  // account exists.
  if (!user) {
    await hashPassword("no-such-user-timing-equaliser");
    log.info({ evt: "auth.failed", reason: "no_user" }, "login failed");
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    log.info(
      { evt: "auth.failed", reason: "bad_password", userId: user.id },
      "login failed",
    );
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }

  const token = await createSession(user.id, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  // Refresh the forensic trail. Best-effort: a failure here must not block
  // the sign-in — the session cookie is what actually gates access.
  updateUserLastSeen({
    userId: user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }).catch(() => {
    /* logged elsewhere via the db client's own error path */
  });
  log.info({ evt: "auth.login", userId: user.id }, "login succeeded");

  const response = NextResponse.json({ userId: user.id }, { status: 200 });
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
