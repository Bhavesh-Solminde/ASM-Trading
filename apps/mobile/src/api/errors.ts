export type GateState = "ok" | "maintenance" | "blocked" | "upgrade" | "offline";

export type Classified =
  | { kind: "ok" }
  | { kind: "gate"; gate: "maintenance" | "blocked" | "upgrade" }
  | { kind: "logout" }
  | { kind: "toast"; message: string }
  | { kind: "error"; status: number; code: string | null; message: string; resolved?: true };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** The server's `resolved: true` on a 409: something else already settled the deposit this call was about. */
    readonly resolved: boolean = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * English fallback for an error body with no message. This module stays free of
 * i18next; UI code that shows an ApiError should prefer t("common.genericError")
 * when `message === GENERIC_ERROR`.
 */
export const GENERIC_ERROR = "Something went wrong.";

function field(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>)[key] === "string") {
    return (body as Record<string, string>)[key] ?? null;
  }
  return null;
}

/**
 * Only a response carrying the explicit `unauthenticated` code ends the session,
 * and only for calls that sent a session. Bare 401s (wrong password, google_failed)
 * are form errors. A rate limit normally toasts; `silentRateLimit` turns it into a plain `rate_limited` error.
 */
export function classifyResponse(
  status: number,
  body: unknown,
  opts: { authed?: boolean; silentRateLimit?: boolean } = {},
): Classified {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const authed = opts.authed ?? true;
  const code = field(body, "code");
  if (code === "unauthenticated" && authed) return { kind: "logout" };
  if (code === "maintenance") return { kind: "gate", gate: "maintenance" };
  if (code === "vpn_blocked") return { kind: "gate", gate: "blocked" };
  if (code === "upgrade_required" || status === 426) return { kind: "gate", gate: "upgrade" };
  const message = field(body, "error") ?? field(body, "message") ?? GENERIC_ERROR;
  if (status === 429 || code === "rate_limited") {
    // A caller that retries on its own schedule (the engine socket) gets a plain error, not a toast per retry.
    if (opts.silentRateLimit) return { kind: "error", status, code: "rate_limited", message };
    return { kind: "toast", message };
  }
  const resolved = body && typeof body === "object" && (body as Record<string, unknown>).resolved === true;
  return resolved ? { kind: "error", status, code, message, resolved: true } : { kind: "error", status, code, message };
}

/** A successful call clears a maintenance/blocked gate only when it hit /api/v1 (not /api/auth/*). */
export function clearsGate(path: string): boolean {
  return path.startsWith("/api/v1/");
}

/**
 * react-query retry predicate: at most one retry, and never for a 4xx ApiError.
 * A 4xx was answered by the server, so repeating it repeats its side effects
 * (a second logout, a second rate-limit toast, re-hitting a gate).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError) {
    if (error.status >= 1 && error.status < 500) return false;
    if (error.code === "maintenance") return false; // a 503 gate, not a transient failure
  }
  return true;
}

/**
 * Which token a request carries and whether an `unauthenticated` reply means "the session is gone".
 * An explicit `token` (the post-sign-out logout) is sent as given but never takes the session-loss
 * path: its 401 must not sign out whatever newer session exists by the time the reply lands.
 */
export function resolveAuth(
  opts: { auth?: boolean; token?: string },
  sessionToken: () => string | null,
): { token: string | null; authed: boolean } {
  if (opts.token !== undefined) return { token: opts.token, authed: false };
  const token = opts.auth !== false ? sessionToken() : null;
  // A request that carried no token (e.g. sent before hydrate() finished) says nothing about the session.
  return { token, authed: token !== null };
}
