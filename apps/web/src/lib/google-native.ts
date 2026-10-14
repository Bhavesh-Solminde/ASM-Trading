import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { logger } from "@asm/logger";
import { GoogleSignInError, type GoogleProfile } from "./google-oauth";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

/**
 * Audiences a native ID token may carry: the Android OAuth client ids, plus the
 * web client id (Android Credential Manager issues tokens for the web client
 * when it is passed as the server client id).
 */
export function googleNativeAudiences(env: Record<string, string | undefined> = process.env): string[] {
  const android = googleAndroidClientIds(env);
  const web = env["GOOGLE_CLIENT_ID"]?.trim();
  return web ? [...android, web] : android;
}

/** The Android OAuth client ids the app signs in with (comma-separated env). */
export function googleAndroidClientIds(env: Record<string, string | undefined> = process.env): string[] {
  return (env["GOOGLE_ANDROID_CLIENT_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Verifies signature + claims of an ID token the app got from Google. */
export async function verifyNativeIdToken(
  idToken: string,
  opts: {
    audiences: string[];
    /**
     * A token whose audience is the web client id (not an Android one) is also
     * what a browser sign-in mints. When both are given, such a token is only
     * accepted if its authorized party (`azp`) is one of the Android client ids.
     */
    webClientId?: string;
    androidClientIds?: string[];
    jwks?: JWTVerifyGetKey;
    nowMs?: number;
  },
): Promise<GoogleProfile> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(idToken, opts.jwks ?? GOOGLE_JWKS, {
      issuer: ISSUERS,
      audience: opts.audiences,
      ...(opts.nowMs ? { currentDate: new Date(opts.nowMs) } : {}),
    });
    claims = payload as Record<string, unknown>;
  } catch (err) {
    // The client only ever sees "invalid id_token"; the log tells a bad token
    // (JWSSignatureVerificationFailed, JWTExpired, JWTClaimValidationFailed…)
    // from a JWKS outage (JWKSTimeout, fetch failures).
    const e = err as { code?: unknown; name?: unknown };
    logger.warn(
      {
        evt: "auth.google_native_verify_failed",
        errName: typeof e.name === "string" ? e.name : "unknown",
        errCode: typeof e.code === "string" ? e.code : undefined,
      },
      "native google id_token verification failed",
    );
    throw new GoogleSignInError("invalid id_token");
  }

  if (
    opts.webClientId &&
    opts.androidClientIds &&
    claims.aud === opts.webClientId &&
    !(typeof claims.azp === "string" && opts.androidClientIds.includes(claims.azp))
  ) {
    throw new GoogleSignInError("unexpected authorized party");
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
