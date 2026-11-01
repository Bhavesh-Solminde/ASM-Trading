import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { buildAuthorizeUrl } from "@/lib/fyers-oauth";

/**
 * GET /api/integrations/fyers/authorize
 *
 * Admin kicks off the FYERS OAuth round-trip here. We sign the admin's
 * intent with a short-lived cookie (the OAuth `state` parameter) so the
 * callback can detect a stale or forged redirect, then 302 the browser to
 * api-t1.fyers.in to log in and approve the app.
 *
 * Admin-only. Non-admins get a 404 so the route doesn't advertise itself.
 */
export async function GET(req: NextRequest) {
  const adminToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const admin = await readAdminSession(adminToken);
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const appId = process.env.FYERS_APP_ID;
  const appSecret = process.env.FYERS_APP_SECRET;
  const redirectUri = process.env.FYERS_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    return NextResponse.json(
      { error: "FYERS env not configured — need FYERS_APP_ID, FYERS_APP_SECRET, FYERS_REDIRECT_URI" },
      { status: 503 },
    );
  }

  // 128-bit CSRF nonce; stored in an httpOnly cookie bound to this redirect.
  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthorizeUrl({ appId, appSecret, redirectUri }, state);

  const res = NextResponse.redirect(authUrl, { status: 302 });
  res.cookies.set("fyers_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/integrations/fyers",
  });
  // The strict admin cookie is deliberately withheld on FYERS' cross-site
  // redirect. This short-lived copy is sent only to the OAuth callback.
  res.cookies.set("fyers_oauth_admin", adminToken!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/integrations/fyers/callback",
  });
  return res;
}
