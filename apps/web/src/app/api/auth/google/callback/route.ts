import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { findOrCreateGoogleUser, findUserByEmail, updateUserLastSeen } from "@asm/db";
import { childLogger } from "@asm/logger";
import {
  GOOGLE_OAUTH_COOKIE,
  appOrigin,
  finishGoogleSignIn,
  googleRedirectUri,
} from "@/lib/google-oauth";
import { checkNetwork } from "@/lib/network-guard/guard";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, createSession } from "@/lib/session";
import { provisionNewUser } from "@/lib/signup";

/**
 * Google sends the browser back here with `code` + `state`. The state must
 * match the one stashed in our cookie (CSRF), the code is redeemed with the
 * PKCE verifier, and the verified identity signs in, links to, or creates an
 * account. Every failure lands on /login with a generic Google error.
 */
export async function GET(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);
  const origin = appOrigin(req.nextUrl.origin);

  const fail = (reason: string) => {
    log.info({ evt: "auth.google_failed", reason }, "google sign-in failed");
    const res = NextResponse.redirect(new URL("/login?error=google", origin));
    res.cookies.set(GOOGLE_OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };

  const okIp = await checkRateLimit(`rl:google:ip:${ctx.ip}`, 20, 300);
  if (!okIp) return fail("rate_limited");

  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state) return fail("denied_or_missing_code");

  const stored = readStash(req.cookies.get(GOOGLE_OAUTH_COOKIE)?.value);
  if (!stored || stored.state !== state) {
    log.warn({ evt: "security.oauth_state_mismatch", route: "google_callback" }, "oauth state mismatch");
    return fail("state_mismatch");
  }

  let profile;
  try {
    profile = await finishGoogleSignIn({
      code,
      verifier: stored.verifier,
      redirectUri: googleRedirectUri(req.nextUrl.origin),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "exchange_failed");
  }

  // Same VPN rule as login/register, checked before any account is created.
  // Looked up by email so a vpnExempt existing account is still recognised.
  const existing = await findUserByEmail(profile.email);
  const guardInput = existing
    ? { ip: ctx.ip, route: "google", log, userId: existing.id }
    : { ip: ctx.ip, route: "google", log };
  if ((await checkNetwork(guardInput)).blocked) {
    return NextResponse.redirect(new URL("/network-blocked", origin));
  }

  let result;
  try {
    result = await findOrCreateGoogleUser({
      sub: profile.sub,
      email: profile.email,
      firstName: profile.givenName,
      lastName: profile.familyName,
      // Random and never shown: a Google-created account has no usable password.
      passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.name : "link_failed");
  }

  if (result.created) {
    await provisionNewUser(result.userId, ctx);
    log.info({ evt: "auth.register", userId: result.userId, via: "google" }, "account created");
  } else {
    updateUserLastSeen({ userId: result.userId, ip: ctx.ip, userAgent: ctx.userAgent }).catch(() => {
      /* best-effort, as on the password login route */
    });
    log.info({ evt: "auth.login", userId: result.userId, via: "google" }, "login succeeded");
  }

  const token = await createSession(result.userId, { ip: ctx.ip, userAgent: ctx.userAgent });
  const response = NextResponse.redirect(new URL("/trade", origin));
  response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return response;
}

/** The state + PKCE verifier the start route stashed, or null if absent/garbled. */
function readStash(raw: string | undefined): { state: string; verifier: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: unknown; verifier?: unknown };
    return typeof parsed.state === "string" && typeof parsed.verifier === "string"
      ? { state: parsed.state, verifier: parsed.verifier }
      : null;
  } catch {
    return null;
  }
}
