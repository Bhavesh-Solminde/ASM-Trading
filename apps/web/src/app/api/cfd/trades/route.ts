import { NextResponse, type NextRequest } from "next/server";
import { CfdOpenTradeSchema, cfdTradeViewFrom } from "@asm/contracts";
import { formatMoney, getAccountForActor, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { getSession, unauthenticated } from "@/lib/request-session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { minStakeMinor } from "@asm/client-core";
import { EngineRejected, EngineUnavailable, engineCfdOpen } from "@/lib/engine-client";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";

const REJECTION_MESSAGE: Record<string, string> = {
  account_not_active: "This account is paused. Contact support.",
  account_not_found: "Account not found.",
  currency_changed: "Your account currency changed. Check the investment and try again.",
  market_closed: "This market is closed. Trading resumes when the market opens and live prices return.",
  invalid_stops: "Check stop loss and take profit. Each level must be on the correct side of the entry price.",
  unknown_asset: "That asset is not available right now.",
  market_unavailable: "Market is temporarily unavailable.",
  trading_paused: "This account is paused. Contact support.",
  stake_exceeds_limit: "Stake exceeds the current limit.",
  insufficient_balance: "Not enough balance for the investment and spread fee.",
};

const BROWSER_STATUS: Record<string, number> = {
  market_closed: 409,
  market_unavailable: 409,
  stake_exceeds_limit: 400,
};

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "cfd_trades", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  if (!(await checkRateLimit(`rl:cfd:${session.userId}`, 60, 60))) {
    log.warn({ evt: "security.rate_limited", route: "cfd_trades" }, "CFD trade throttled");
    return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
  }

  const parsed = CfdOpenTradeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "cfd_trades" }, "rejected CFD trade payload");
    return NextResponse.json({ error: "Check the trade details." }, { status: 400 });
  }

  const account = await getAccountForActor(session.userId, parsed.data.accountId);
  if (!account) {
    log.warn(
      { evt: "security.authz_denied", route: "cfd_trades", accountId: parsed.data.accountId },
      "account does not belong to actor",
    );
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  if (parsed.data.currency && parsed.data.currency !== account.currency) {
    return NextResponse.json({ error: "Your account currency changed. Check the investment and try again.", code: "currency_changed" }, { status: 409 });
  }
  const minStake = minStakeMinor(account.currency);
  if (parsed.data.stake < minStake) {
    return NextResponse.json(
      { error: `Minimum investment is ${formatMoney(minStake, account.currency)}.` },
      { status: 400 },
    );
  }

  try {
    const result = await engineCfdOpen({ ...parsed.data, actorId: session.userId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json(
        { error: REJECTION_MESSAGE[err.reason] ?? "Could not place that trade.", code: err.reason },
        { status: BROWSER_STATUS[err.reason] ?? err.status },
      );
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "cfd.open_rejected", reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const account = await getAccountForActor(session.userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  // Never hide an older open position behind more recent closes: it must remain manageable.
  const [open, closed] = await Promise.all([
    prisma.trade.findMany({ where: { accountId, durationSec: { not: null }, status: "OPEN" }, orderBy: { createdAt: "desc" }, include: { asset: { select: { symbol: true } } } }),
    prisma.trade.findMany({ where: { accountId, durationSec: { not: null }, status: "CLOSED" }, orderBy: { closedAt: "desc" }, take: 50, include: { asset: { select: { symbol: true } } } }),
  ]);
  const trades = [...open, ...closed];

  return NextResponse.json(
    {
      currency: account.currency,
      trades: trades.map((t) => cfdTradeViewFrom(t, t.asset.symbol)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
