import { NextResponse, type NextRequest } from "next/server";
import { OpenTradeSchema,OtcOpenTradeSchema, tradeViewFrom } from "@asm/contracts";
import { formatMoney, getAccountForActor, listTradesForActor, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { minStakeMinor } from "@asm/client-core";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "@/lib/engine-client";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { engineOtcOpen } from "@/lib/otc-client";
import { getSession, unauthenticated, rateLimited } from "@/lib/request-session";

const REJECTION_MESSAGE: Record<string, string> = {
  display_quote_expired: "That displayed price has expired. Wait for a fresh price and try again.",
  "Liquidity unavailable": "There is not enough liquidity for this trade. Your stake has been returned.",
  "Market price unavailable": "Waiting for a recent market execution. Try again shortly.",
  "Invalid stop loss": "Stop loss must be on the loss side of the entry price.",
  "Invalid take profit": "Take profit must be on the profit side of the entry price.",
  trading_model_mismatch: "Trading mode changed. Refresh the page before placing another trade.",
  insufficient_funds: "Not enough balance for that stake.",
  unknown_asset: "That asset is not available right now.",
  account_not_found: "Account not found.",
  account_not_active: "This account is paused. Contact support.",
  market_closed:
    "This market is closed for the night. Trading resumes at 5:00 AM IST.",
};

// A closed market is the trader's state, not our outage — the engine's 503
// would read as "Service Unavailable" in the browser.
const BROWSER_STATUS: Record<string, number> = { market_closed: 409 };

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }
  if(process.env.OTC_DRAIN_LEGACY==="true"&&process.env.OTC_ORDER_BOOK_ENABLED!=="true")return NextResponse.json({error:"New trades are paused for the OTC upgrade. Existing positions will settle normally."},{status:409});

  if ((await checkNetwork({ ip: ctx.ip, route: "trades", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  if (!(await checkRateLimit(`rl:trade:${session.userId}`, 60, 60))) {
    log.warn({ evt: "security.rate_limited", route: "trades" }, "trade throttled");
    return rateLimited("Slow down a moment and try again.");
  }

  const otc=process.env.OTC_ORDER_BOOK_ENABLED==="true";
  const parsed = (otc?OtcOpenTradeSchema:OpenTradeSchema).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "trades" }, "rejected trade payload");
    const missingQuote=otc&&parsed.error.issues.some(issue=>issue.path[0]==="quoteToken");
    return NextResponse.json({ error: missingQuote ? "Refresh the page to receive a current trading price." : "Check the trade details." }, { status: 400 });
  }

  // Ownership first — a foreign account never reaches the engine.
  const account = await getAccountForActor(session.userId, parsed.data.accountId);
  if (!account) {
    log.warn(
      { evt: "security.authz_denied", route: "trades", accountId: parsed.data.accountId },
      "account does not belong to actor",
    );
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  // Stale-currency guard. The account can be converted (INR <-> USD, ₹110 = $1) from another tab or device while a
  // ticket is open; a stake typed for the old currency would then be 110x off. A client that states its currency
  // is refused on a mismatch (before the minimum-stake check, which would blame the wrong number). Clients that
  // send none (older app builds, cached web pages) are unaffected.
  if (parsed.data.currency && parsed.data.currency !== account.currency) {
    log.info({ evt: "trade.rejected", reason: "currency_changed", accountId: account.id }, "stake sent in a stale currency");
    return NextResponse.json(
      { error: "Your account currency changed. Check your stake and try again.", code: "currency_changed" },
      { status: 409 },
    );
  }

  const minStake = minStakeMinor(account.currency);
  if (parsed.data.stake < minStake) {
    return NextResponse.json(
      { error: `Minimum investment is ${formatMoney(minStake, account.currency)}.`, code: "min_stake" },
      { status: 400 },
    );
  }

  try {
    const order = { ...parsed.data };
    delete order.currency;
    const result = otc?await engineOtcOpen({...OtcOpenTradeSchema.parse(parsed.data),actorId:session.userId}):await engineOpenTrade({ ...order, actorId: session.userId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EngineRejected) {
      log.warn({ evt: "trade.rejected", reason: err.reason, symbol: parsed.data.symbol }, "trade rejected");
      return NextResponse.json(
        { error: REJECTION_MESSAGE[err.reason] ?? "Could not place that trade.", code:err.reason },
        { status: BROWSER_STATUS[err.reason] ?? err.status },
      );
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "trade.rejected", reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable.", code: "trading_unavailable" }, { status: 503 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  const accountId = OpenTradeSchema.shape.accountId.safeParse(
    req.nextUrl.searchParams.get("accountId"),
  );
  if (!accountId.success) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const trades = await listTradesForActor(session.userId, accountId.data, 50);
  const assets = await prisma.asset.findMany({
    where: { id: { in: [...new Set(trades.map((t) => t.assetId))] } },
    select: { id: true, symbol: true },
  });
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]));

  return NextResponse.json(
    { trades: trades.map((t) => tradeViewFrom(t, symbolById.get(t.assetId) ?? "UNKNOWN")) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
