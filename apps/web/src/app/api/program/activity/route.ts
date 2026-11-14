import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listProgramActivity } from "@asm/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession, noStoreJson, rateLimited, unauthenticated } from "@/lib/request-session";

const QuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.iso.datetime({ offset: true }).optional(),
});

/** The caller's own earnings, transfers and withdrawals, newest first. `before` pages back. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (!(await checkRateLimit(`rl:program-read:${session.userId}`, 120, 60))) return rateLimited();

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Check the history filters." }, { status: 400 });

  const { limit, before } = parsed.data;
  const items = await listProgramActivity(session.userId, { limit, ...(before ? { before: new Date(before) } : {}) });
  return noStoreJson({ items });
}
