import { NextResponse, type NextRequest } from "next/server";
import { WithdrawalRefused, cancelHeldWithdrawal } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Cancels a HELD withdrawal and refunds the money to the user's realBalance.
 * The handler enforces ownership and the cancel-window check in the request
 * layer and again inside the repo transaction, so a concurrent double-submit
 * cannot double-credit the account.
 *
 * 404 — no such withdrawal, or it does not belong to the caller.
 * 409 — the withdrawal is no longer cancellable (expired, already acted on).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:withdraw-cancel:${session.userId}`, 20, 300))) {
    log.warn({ evt: "security.rate_limited", route: "withdraw-cancel" }, "cancel throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Withdrawal id missing." }, { status: 400 });
  }

  try {
    const withdrawal = await cancelHeldWithdrawal({
      actorId: session.userId,
      withdrawalId: id,
    });
    return NextResponse.json({ withdrawal }, { status: 200 });
  } catch (err) {
    if (err instanceof WithdrawalRefused) {
      // The two "found but not actionable" messages are 409 (state conflict);
      // "not found" is 404 and intentionally covers an unknown id or an id
      // owned by someone else, so an attacker can't enumerate withdrawals.
      const status = /not found/i.test(err.message) ? 404 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
