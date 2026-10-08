import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  destroyAllSessionsForUser,
  destroySession,
  readSession,
} from "@/lib/session";

/** A plain HTML form post (no JS) rather than a fetch() from our own code. */
function isFormPost(req: NextRequest): boolean {
  const type = req.headers.get("content-type") ?? "";
  return type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const all = req.nextUrl.searchParams.get("all") === "1";

  if (token) {
    if (all) {
      // Look up the owner first so a stolen token can still only revoke its
      // own user's sessions — readSession validates against the DB.
      const session = await readSession(token);
      if (session) await destroyAllSessionsForUser(session.userId);
      else await destroySession(token);
    } else {
      await destroySession(token);
    }
  }

  // A form post must navigate somewhere: a 204 leaves the browser sitting on
  // the signed-in page until a manual refresh. fetch() callers navigate
  // themselves, so they keep the empty 204. The relative Location stays
  // correct behind the proxy.
  const response = isFormPost(req)
    ? new NextResponse(null, { status: 303, headers: { Location: "/login" } })
    : new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
