import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./session-cookie";
import { readSession, type SessionReadResult } from "./session";

/** Session tokens are 32 random bytes, base64url (43 chars). */
const BEARER = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/;

type SessionSource = Pick<NextRequest, "headers" | "cookies">;

/**
 * The app sends `Authorization: Bearer <token>`; the website sends the cookie.
 * A request that carries an Authorization header is judged on it alone — a
 * malformed or wrong bearer never falls back to a cookie riding along.
 */
export function sessionTokenFrom(req: SessionSource): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth !== null) return BEARER.exec(auth.trim())?.[1];
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export function getSession(req: SessionSource): Promise<SessionReadResult | null> {
  return readSession(sessionTokenFrom(req));
}

export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "Not signed in.", code: "unauthenticated" }, { status: 401 });
}

export function rateLimited(message = "Too many requests."): NextResponse {
  return NextResponse.json({ error: message, code: "rate_limited" }, { status: 429 });
}

export function noStoreJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}
