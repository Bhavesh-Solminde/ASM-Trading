import type { NextRequest } from "next/server";
import { getProgramSummary } from "@asm/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession, noStoreJson, rateLimited, unauthenticated } from "@/lib/request-session";

/** The caller's own program balances, terms, limits and blockers. Aggregates only. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (!(await checkRateLimit(`rl:program-read:${session.userId}`, 120, 60))) return rateLimited();
  return noStoreJson(await getProgramSummary(session.userId));
}
