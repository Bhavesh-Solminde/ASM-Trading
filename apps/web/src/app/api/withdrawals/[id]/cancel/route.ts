import { NextResponse, type NextRequest } from "next/server";
import { WithdrawalRefused, cancelHeldWithdrawal, listAccountsForActor } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { getSession, unauthenticated, rateLimited } from "@/lib/request-session";

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

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "withdrawals_cancel", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  if (!(await checkRateLimit(`rl:withdraw-cancel:${session.userId}`, 20, 300))) {
    log.warn({ evt: "security.rate_limited", route: "withdraw-cancel" }, "cancel throttled");
    return rateLimited("Too many attempts. Wait a few minutes.");
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
    // Live-balance push — the engine isn't involved in a cancel, so there
    // is no `balance:update` coming on the socket. Return the LIVE
    // account's fresh balance so the client re-seeds PlatformProvider
    // state and the TopBar reflects the refund immediately.
    const liveAccount = (await listAccountsForActor(session.userId)).find(
      (a) => a.type === "LIVE",
    );
    return NextResponse.json(
      {
        withdrawal,
        accountId: liveAccount?.id ?? null,
        balance: liveAccount
          ? { realBalance: liveAccount.realBalance, bonusBalance: liveAccount.bonusBalance }
          : null,
      },
      { status: 200 },
    );
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
