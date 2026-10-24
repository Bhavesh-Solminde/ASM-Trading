import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { exchangeAuthCode, nextFyersExpiry } from "@/lib/fyers-oauth";

/**
 * GET /api/integrations/fyers/callback
 *
 * FYERS redirects the admin's browser here after they sign in and approve
 * the app. We verify the `state` matches the cookie set by /authorize,
 * exchange the one-shot `auth_code` for a day-long `access_token`, and
 * upsert it into IntegrationToken. The token value is never logged, never
 * returned to the client, and never leaves the server-side DB.
 *
 * Admin-only (404 otherwise, so the URL doesn't advertise itself).
 */
export async function GET(req: NextRequest) {
  const admin = await readAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (!admin) return new NextResponse("Not found", { status: 404 });

  const url = new URL(req.url);
  const authCode = url.searchParams.get("auth_code");
  const state = url.searchParams.get("state");
  const s = url.searchParams.get("s");
  const cookieState = req.cookies.get("fyers_oauth_state")?.value;

  if (!authCode || !state || !cookieState || state !== cookieState) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state. Start again from /api/integrations/fyers/authorize." },
      { status: 400 },
    );
  }
  if (s && s !== "ok") {
    return NextResponse.json({ error: `FYERS returned s=${s}` }, { status: 400 });
  }

  const appId = process.env.FYERS_APP_ID;
  const appSecret = process.env.FYERS_APP_SECRET;
  const redirectUri = process.env.FYERS_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    return NextResponse.json({ error: "FYERS env not configured" }, { status: 503 });
  }

  let token;
  try {
    token = await exchangeAuthCode({ appId, appSecret, redirectUri }, authCode);
  } catch (err) {
    // Network / parse errors — the FYERS endpoint returned something unexpected.
    logger.warn({ evt: "fyers.token_exchange_error", err: String(err) }, "FYERS token exchange network error");
    return NextResponse.json({ error: "Token exchange network error" }, { status: 502 });
  }

  if (token.s !== "ok" || !token.access_token) {
    // DELIBERATELY generic — we don't echo the FYERS message to the browser
    // because it occasionally includes diagnostic text we'd rather not expose.
    logger.warn({ evt: "fyers.token_exchange_rejected", code: token.code, message: token.message },
      "FYERS token exchange rejected");
    return NextResponse.json({ error: "FYERS rejected the authorization code." }, { status: 400 });
  }

  const expiresAt = nextFyersExpiry();
  await prisma.integrationToken.upsert({
    where: { provider: "fyers" },
    create: {
      provider: "fyers",
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt,
    },
  });

  logger.info(
    { evt: "fyers.token_stored", expiresAt: expiresAt.toISOString() },
    "FYERS access token stored; feed will pick it up on next poll cycle",
  );

  // Drop the one-shot state cookie now that the exchange is complete.
  const res = NextResponse.json({
    status: "connected",
    expiresAt: expiresAt.toISOString(),
    message: "FYERS integration active. Close this tab.",
  });
  res.cookies.delete("fyers_oauth_state");
  return res;
}
