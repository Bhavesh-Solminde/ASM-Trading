import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  destroyAllSessionsForUser,
  destroySession,
  readSession,
} from "@/lib/session";

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

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
