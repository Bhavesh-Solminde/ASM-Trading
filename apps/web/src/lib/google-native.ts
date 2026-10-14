import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { GoogleSignInError, type GoogleProfile } from "./google-oauth";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/**
 * Audiences a native ID token may carry: the Android OAuth client ids, plus the
 * web client id (Android Credential Manager issues tokens for the web client
 * when it is passed as the server client id).
 */
export function googleNativeAudiences(env: Record<string, string | undefined> = process.env): string[] {
  const android = (env["GOOGLE_ANDROID_CLIENT_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const web = env["GOOGLE_CLIENT_ID"]?.trim();
  return web ? [...android, web] : android;
}

/** Verifies signature + claims of an ID token the app got from Google. */
export async function verifyNativeIdToken(
  idToken: string,
  opts: { audiences: string[]; jwks?: JWTVerifyGetKey; nowMs?: number },
): Promise<GoogleProfile> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(idToken, opts.jwks ?? GOOGLE_JWKS, {
      issuer: ISSUERS,
      audience: opts.audiences,
      ...(opts.nowMs ? { currentDate: new Date(opts.nowMs) } : {}),
    });
    claims = payload as Record<string, unknown>;
  } catch {
    throw new GoogleSignInError("invalid id_token");
  }

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
