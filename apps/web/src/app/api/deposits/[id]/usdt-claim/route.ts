import { NextResponse, type NextRequest } from "next/server";
import { ClaimUsdtPaymentSchema } from "@asm/contracts";
import { DepositAlreadyResolved, DepositNotFound, claimUsdtPayment } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";

/**
 * USDT "I already paid": the user attaches the transaction hash (and
 * optionally a screenshot URL) to THEIR deposit. Evidence for an admin
 * reviewing an unmatched on-chain transfer only — a tx hash is public, so
 * this never credits, never changes the deposit's status and never feeds the
 * matcher (see claimUsdtPayment).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "deposits_usdt_claim", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  if (!(await checkRateLimit(`rl:usdt-claim:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "deposit_usdt_claim" }, "usdt claim throttled");
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const { id } = await params;
  const parsed = ClaimUsdtPaymentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "deposit_usdt_claim" },
      "rejected usdt claim payload",
    );
    return NextResponse.json(
      { error: "Paste the 64-character transaction hash from your wallet." },
      { status: 400 },
    );
  }

  try {
    // Ownership is enforced inside claimUsdtPayment, which takes the actor id.
    const deposit = await claimUsdtPayment({
      actorId: session.userId,
      depositId: id,
      txHash: parsed.data.txHash,
      screenshotUrl: parsed.data.screenshotUrl ?? null,
    });
    log.info(
      {
        evt: "deposit.usdt_payment_claimed",
        depositId: deposit.id,
        cid: deposit.correlationId,
        hasScreenshot: Boolean(parsed.data.screenshotUrl),
      },
      "usdt payment claimed",
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DepositNotFound) {
      log.warn(
        { evt: "security.authz_denied", route: "deposit_usdt_claim", depositId: id },
        "deposit does not belong to actor",
      );
      return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    }
    if (err instanceof DepositAlreadyResolved) {
      return NextResponse.json({ error: "This deposit has already been resolved." }, { status: 409 });
    }
    throw err;
  }
}
