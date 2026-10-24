import { createHash } from "node:crypto";

/**
 * Pure helpers for the FYERS OAuth 2.0 flow (v3). Separated from the route
 * handlers so each piece is independently unit-testable without spinning up
 * Next's request/response plumbing.
 *
 * Reference: https://myapi.fyers.in/docsv3
 */

export const FYERS_AUTH_URL = "https://api-t1.fyers.in/api/v3/generate-authcode";
export const FYERS_TOKEN_URL = "https://api-t1.fyers.in/api/v3/validate-authcode";

export interface FyersOAuthEnv {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Build the browser-facing authorization URL the admin visits to sign in. */
export function buildAuthorizeUrl(env: FyersOAuthEnv, state: string): string {
  const url = new URL(FYERS_AUTH_URL);
  url.searchParams.set("client_id", env.appId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * FYERS requires the token-exchange body to carry `appIdHash` =
 * SHA-256 hex of "APP_ID:APP_SECRET". Separated for test coverage because an
 * off-by-one here breaks every integration silently (server returns an opaque
 * error code).
 */
export function appIdHash(env: Pick<FyersOAuthEnv, "appId" | "appSecret">): string {
  return createHash("sha256").update(`${env.appId}:${env.appSecret}`).digest("hex");
}

export interface FyersTokenResponse {
  s: string;
  code?: number;
  access_token?: string;
  refresh_token?: string;
  message?: string;
}

/**
 * Exchange the one-shot `auth_code` for a day-long `access_token`. Isolated as
 * a function (not inlined in the route) so the HTTP side can be mocked in
 * tests without standing up a Next request.
 */
export async function exchangeAuthCode(
  env: FyersOAuthEnv,
  authCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FyersTokenResponse> {
  const resp = await fetchImpl(FYERS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      appIdHash: appIdHash(env),
      code: authCode,
    }),
  });
  // FYERS always returns 200 with an `s` field — "ok" on success, "error" otherwise.
  return (await resp.json()) as FyersTokenResponse;
}

/**
 * FYERS access tokens expire at 06:00 IST (next day). Returns the next 06:00
 * IST instant after `now` as a Date (UTC-anchored). We store this as the row's
 * `expiresAt`; a cron can check this and prompt a re-authorize before expiry.
 */
export function nextFyersExpiry(now: Date = new Date()): Date {
  // 06:00 IST = 00:30 UTC.
  const utc = new Date(now.getTime());
  const todayExpiry = new Date(Date.UTC(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    0, 30, 0, 0,
  ));
  if (todayExpiry.getTime() <= utc.getTime()) {
    // Already past today's 00:30 UTC — expiry is tomorrow's 00:30 UTC.
    todayExpiry.setUTCDate(todayExpiry.getUTCDate() + 1);
  }
  return todayExpiry;
}

/**
 * The token value we pass to downstream FYERS APIs is formatted as
 * `APP_ID:ACCESS_TOKEN`. Returned helper so neither route nor feed has to know.
 */
export function fyersAuthHeader(appId: string, accessToken: string): string {
  return `${appId}:${accessToken}`;
}
