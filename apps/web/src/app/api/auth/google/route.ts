import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_OAUTH_COOKIE,
  GOOGLE_OAUTH_COOKIE_OPTIONS,
  appOrigin,
  googleRedirectUri,
  startGoogleSignIn,
} from "@/lib/google-oauth";

/** "Continue with Google": stash state + PKCE verifier, then hand off to Google. */
export async function GET(req: NextRequest) {
  const start = startGoogleSignIn(googleRedirectUri(req.nextUrl.origin));
  if (!start) {
    return NextResponse.redirect(new URL("/login?error=google", appOrigin(req.nextUrl.origin)));
  }

  const response = NextResponse.redirect(start.url);
  response.cookies.set(
    GOOGLE_OAUTH_COOKIE,
    JSON.stringify({ state: start.state, verifier: start.verifier }),
    GOOGLE_OAUTH_COOKIE_OPTIONS,
  );
  return response;
}
