import { NextResponse, type NextRequest } from "next/server";
import { childLogger } from "@asm/logger";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_OPTIONS,
  createAdminSession,
  verifyAdminSecret,
} from "@/lib/admin-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const okIp = await checkRateLimit(`rl:admin_login:ip:${ctx.ip}`, 10, 300);
  if (!okIp) {
    log.warn({ evt: "security.rate_limited", route: "admin_login" }, "admin login throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait five minutes and try again." },
      { status: 429 },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const secret = typeof body === "object" && body !== null && "secret" in body
    ? String((body as { secret: unknown }).secret)
    : "";

  if (!verifyAdminSecret(secret)) {
    log.warn({ evt: "security.authz_denied", route: "admin_login" }, "wrong admin secret");
    return NextResponse.json({ error: "Incorrect secret." }, { status: 401 });
  }

  const token = await createAdminSession();
  log.info({ evt: "admin.login" }, "admin session created");

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_COOKIE_OPTIONS);
  return response;
}
