import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/session-cookie";
import {
  MAINTENANCE_PATH,
  MAINTENANCE_RETRY_AFTER,
  isAllowedDuringMaintenance,
  isApiPath,
  isMaintenanceMode,
} from "@/lib/maintenance";

/**
 * Security headers set centrally so no route can omit them. Asserted by an
 * integration test in Task 13 rather than by inspection.
 *
 * Also re-issues the session cookie on every request when it's present, so
 * the browser's Max-Age keeps rolling forward alongside the DB expiresAt
 * (which readSession refreshes on the server). This is the client half of
 * the sliding "refresh token" behavior — an active user never falls off the
 * 7-day cliff.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated the
 * middleware.ts convention in favour of proxy.ts (same behaviour, new file
 * and export name). The rename is also what makes maintenance mode work —
 * proxy runs on the Node.js runtime, so process.env is read per request
 * instead of being inlined at build time.
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Maintenance gate runs before anything else — a request that is being
  // turned away should not also be renewing its session cookie.
  if (isMaintenanceMode() && !isAllowedDuringMaintenance(pathname)) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: "MAINTENANCE", message: "Service temporarily unavailable." },
        {
          status: 503,
          headers: { "Retry-After": String(MAINTENANCE_RETRY_AFTER) },
        },
      );
    }
    return NextResponse.rewrite(new URL(MAINTENANCE_PATH, request.url), {
      status: 503,
      headers: { "Retry-After": String(MAINTENANCE_RETRY_AFTER) },
    });
  }

  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()",
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
  // Set-Cookie isn't racing a proxy-issued renewal in the same response.
  const isAuthRoute = pathname.startsWith("/api/auth/");
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
