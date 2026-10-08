import { createHash, randomBytes } from "node:crypto";
import { SITE_URL } from "@/lib/site";

/**
 * "Continue with Google" — OAuth 2.0 authorization-code flow with PKCE.
 *
 * Off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (Google Cloud
 * console → APIs & Services → Credentials → OAuth client ID, type "Web
 * application", authorised redirect URI = googleRedirectUri()). The login and
 * register pages hide the button while it is off.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Holds state + PKCE verifier between the redirect out and the callback. */
export const GOOGLE_OAUTH_COOKIE = "asm_google_oauth";
export const GOOGLE_OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax: the callback is a top-level GET navigation back from Google, which
  // Lax cookies survive and Strict ones don't.
  sameSite: "lax" as const,
  path: "/api/auth/google",
  maxAge: 600,
};

function credentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function googleSignInEnabled(): boolean {
  return credentials() !== null;
}

/** Where the browser is sent back to. Production always uses the public site
 *  URL — behind the VPS proxy the request's own origin is the plain-http
 *  upstream — while dev uses whatever origin the browser is on. */
export function appOrigin(requestOrigin: string): string {
  return process.env.NODE_ENV === "production" ? SITE_URL : requestOrigin;
}

/** Must match the URI registered on the OAuth client exactly. */
export function googleRedirectUri(requestOrigin: string): string {
  return `${appOrigin(requestOrigin)}/api/auth/google/callback`;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Fresh state + PKCE pair for one sign-in attempt, and the URL to send the browser to. */
export function startGoogleSignIn(redirectUri: string): {
  url: string;
  state: string;
  verifier: string;
} | null {
  const creds = credentials();
  if (!creds) return null;
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, verifier };
}

export interface GoogleProfile {
  sub: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
}

export class GoogleSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSignInError";
  }
}

/**
 * Trades the callback's code for the user's verified Google identity. The ID
 * token comes straight from Google's token endpoint over TLS, authenticated
 * with our client secret, so (per OpenID Connect Core §3.1.3.7) TLS stands in
 * for a signature check; issuer, audience and expiry are still verified.
 */
export async function finishGoogleSignIn(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<GoogleProfile> {
  const creds = credentials();
  if (!creds) throw new GoogleSignInError("Google sign-in is not configured.");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleSignInError(`token endpoint returned ${res.status}`);
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== "string") throw new GoogleSignInError("no id_token");

  return parseIdToken(body.id_token, creds.clientId, Date.now());
}

/** Decodes and checks an ID token's claims. Exported for tests. */
export function parseIdToken(idToken: string, clientId: string, nowMs: number): GoogleProfile {
  const payloadPart = idToken.split(".")[1];
  if (!payloadPart) throw new GoogleSignInError("malformed id_token");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new GoogleSignInError("malformed id_token");
  }

  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new GoogleSignInError("bad issuer");
  if (claims.aud !== clientId) throw new GoogleSignInError("bad audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) throw new GoogleSignInError("expired");
  if (typeof claims.sub !== "string" || claims.sub === "") throw new GoogleSignInError("no subject");
  if (typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new GoogleSignInError("email not verified");
  }

  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    givenName: typeof claims.given_name === "string" ? claims.given_name : null,
    familyName: typeof claims.family_name === "string" ? claims.family_name : null,
  };
}
