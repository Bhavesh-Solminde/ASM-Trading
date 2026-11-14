import { NextResponse, type NextRequest } from "next/server";
import { cancelProgramWithdrawal } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession, rateLimited, unauthenticated } from "@/lib/request-session";
import { refusedResponse } from "../../../refused";

/**
 * Cancels the caller's own REQUESTED program withdrawal; the amount goes back to available.
 * 404 — unknown id or someone else's; 409 — no longer REQUESTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) return unauthenticated();

  if (!(await checkRateLimit(`rl:program-withdraw-cancel:${session.userId}`, 20, 300))) {
    log.warn({ evt: "security.rate_limited", route: "program_withdraw_cancel" }, "cancel throttled");
    return rateLimited("Too many attempts. Wait a few minutes.");
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Withdrawal id missing." }, { status: 400 });

  try {
    const w = await cancelProgramWithdrawal({ userId: session.userId, withdrawalId: id });
    return NextResponse.json({ id: w.id, status: w.status, amountMinor: w.amountMinor });
  } catch (err) {
    return refusedResponse(err);
  }
}
