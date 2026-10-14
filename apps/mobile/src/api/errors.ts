export type GateState = "ok" | "maintenance" | "blocked" | "upgrade" | "offline";

export type Classified =
  | { kind: "ok" }
  | { kind: "gate"; gate: "maintenance" | "blocked" | "upgrade" }
  | { kind: "logout" }
  | { kind: "toast"; message: string }
  | { kind: "error"; status: number; code: string | null; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
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
 * are form errors.
 */
export function classifyResponse(status: number, body: unknown, opts: { authed?: boolean } = {}): Classified {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const authed = opts.authed ?? true;
  const code = field(body, "code");
  if (code === "unauthenticated" && authed) return { kind: "logout" };
  if (code === "maintenance") return { kind: "gate", gate: "maintenance" };
  if (code === "vpn_blocked") return { kind: "gate", gate: "blocked" };
  if (code === "upgrade_required" || status === 426) return { kind: "gate", gate: "upgrade" };
  const message = field(body, "error") ?? field(body, "message") ?? GENERIC_ERROR;
  if (status === 429 || code === "rate_limited") return { kind: "toast", message };
  return { kind: "error", status, code, message };
}

/** A successful call clears a maintenance/blocked gate only when it hit /api/v1 (not /api/auth/*). */
export function clearsGate(path: string): boolean {
  return path.startsWith("/api/v1/");
}
