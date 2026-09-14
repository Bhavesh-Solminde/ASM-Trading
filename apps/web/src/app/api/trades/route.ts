import { NextResponse, type NextRequest } from "next/server";
import { OpenTradeSchema, tradeViewFrom } from "@asm/contracts";
import { getAccountForActor, listTradesForActor, prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "@/lib/engine-client";

const REJECTION_MESSAGE: Record<string, string> = {
  insufficient_funds: "Not enough balance for that stake.",
  unknown_asset: "That asset is not available right now.",
  account_not_found: "Account not found.",
};

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:trade:${session.userId}`, 60, 60))) {
    log.warn({ evt: "security.rate_limited", route: "trades" }, "trade throttled");
    return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
  }

  const parsed = OpenTradeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "trades" }, "rejected trade payload");
    return NextResponse.json({ error: "Check the trade details." }, { status: 400 });
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

  try {
    const result = await engineOpenTrade({ ...parsed.data, actorId: session.userId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json(
        { error: REJECTION_MESSAGE[err.reason] ?? "Could not place that trade." },
        { status: err.status },
      );
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "trade.rejected", reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
