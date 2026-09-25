import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session-cookie";

/**
 * Security headers set centrally so no route can omit them. Asserted by an
 * integration test in Task 13 rather than by inspection.
 *
 * Also re-issues the session cookie on every request when it's present, so
 * the browser's Max-Age keeps rolling forward alongside the DB expiresAt
 * (which readSession refreshes on the server). This is the client half of
 * the sliding "refresh token" behavior — an active user never falls off the
 * 7-day cliff.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // res.cloudinary.com hosts payment-screenshot uploads shown on the admin
      // approvals queue and the checkout preview thumbnail.
      "img-src 'self' data: blob: https://res.cloudinary.com",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  // Skip re-issuing the cookie on auth routes so a logout's clearing
  // Set-Cookie isn't racing a middleware-issued renewal in the same
  // response.
  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/api/auth/");
  if (!isAuthRoute) {
    const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
    if (sessionToken) {
      response.cookies.set(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);
    }
  }

  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
