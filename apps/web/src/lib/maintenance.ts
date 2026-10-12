/**
 * Maintenance mode — a single env switch that takes the site down for users
 * while leaving it operable for whoever is doing the maintenance.
 *
 * Read at REQUEST time, not build time. That works because Next 16's proxy
 * runs on the Node.js runtime, so flipping MAINTENANCE_MODE in
 * .env.production and restarting the web container is enough — no rebuild,
 * no deploy. Under the old Edge-runtime middleware this would have been
 * inlined at build time and the switch would have done nothing.
 */

/** Truthy spellings accepted so "1", "true" and "on" all work in a .env file. */
const ON = new Set(["1", "true", "on", "yes"]);

/**
 * Takes a plain record rather than NodeJS.ProcessEnv: this project's
 * ProcessEnv declares NODE_ENV as required, which would force every test to
 * construct one just to check a single variable. `process.env` is assignable
 * to this, so the default still reads the real environment.
 */
export function isMaintenanceMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return ON.has((env["MAINTENANCE_MODE"] ?? "").trim().toLowerCase());
}

/** Where the proxy sends a blocked page request. */
export const MAINTENANCE_PATH = "/maintenance";

/**
 * Paths that stay live while maintenance is on.
 *
 * The admin console and the auth routes it needs are deliberately open: the
 * whole point of maintenance mode is that someone is working, and locking the
 * operator out of the console while the site is down is the one failure this
 * must not have. Everything under /admin is already session-gated, so leaving
 * the path reachable exposes nothing a logged-out visitor can use.
 *
 * `/api/health` is listed for container and uptime probes — a probe that
 * starts failing the moment maintenance begins turns a planned window into a
 * pager storm.
 */
const ALWAYS_ALLOWED = [
  MAINTENANCE_PATH,
  "/admin",
  "/api/auth",
  "/api/health",
  // Next internals and the static assets the maintenance page itself needs.
  "/_next",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/manifest.webmanifest",
];

/**
 * Match on whole path segments, never on a raw prefix. A bare
 * `startsWith("/admin")` would also let `/administrator` through, which is
 * how an allowlist quietly grows a hole — so a match is the path itself or
 * the path followed by a separator.
 */
export function isAllowedDuringMaintenance(pathname: string): boolean {
  return ALWAYS_ALLOWED.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

/**
 * An API caller gets JSON and a 503 rather than a rewritten HTML page, so a
 * fetch from a stale open tab fails cleanly instead of trying to parse the
 * maintenance screen as JSON.
 */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export const MAINTENANCE_MESSAGE =
  "IndianXTrade is briefly offline for scheduled maintenance. Trading will be back shortly.";

/** Seconds. Advisory only — tells crawlers and clients when to come back. */
export const MAINTENANCE_RETRY_AFTER = 900;
