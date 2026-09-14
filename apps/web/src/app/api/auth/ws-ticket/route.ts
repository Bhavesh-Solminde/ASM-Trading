import { NextResponse, type NextRequest } from "next/server";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { issueWsTicket } from "@/lib/ws-ticket";

/**
 * Mints a one-time WebSocket ticket for the signed-in caller. POST, not GET:
 * it creates server-side state, and must never be cached or prefetched.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Each reconnect mints one ticket; 30 a minute is generous for backoff and
  // still bounds a script hammering the endpoint.
  if (!(await checkRateLimit(`rl:ws_ticket:${session.userId}`, 30, 60))) {
    log.warn({ evt: "security.rate_limited", route: "ws_ticket" }, "ws ticket throttled");
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const ticket = await issueWsTicket(session.userId);
  return NextResponse.json({ ticket }, { headers: { "Cache-Control": "no-store" } });
}
