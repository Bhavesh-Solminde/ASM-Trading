/**
 * Cookie constants used by both the middleware (Edge runtime, no DB access)
 * and the session module (Node runtime, DB-backed). Keeping these in their
 * own file avoids pulling Prisma into the Edge bundle.
 */

export const SESSION_COOKIE = "asm_session";

/** Absolute lifetime of a session in the database. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * When a valid session is read and the remaining lifetime falls below this
 * threshold, the DB expiresAt is bumped and the cookie is re-issued. This
 * gives the "refresh token" behavior: as long as the user keeps using the
 * app, their session keeps rolling forward.
 */
export const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 6;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // "lax" survives top-level cross-site navigations (e.g. the browser
  // restoring tabs on relaunch) that "strict" drops, which is what the
  // logout-on-refresh reports pointed at. CSRF exposure stays negligible
  // because every mutating route requires JSON and is same-origin.
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
