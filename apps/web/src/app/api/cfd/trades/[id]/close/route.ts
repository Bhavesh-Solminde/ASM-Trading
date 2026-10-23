import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { EngineRejected, EngineUnavailable, engineCfdClose } from "@/lib/engine-client";

const REJECTION_MESSAGE: Record<string, string> = {
  not_found: "Trade not found.",
  trade_not_open: "This trade is no longer open.",
  lockout_active: "Please wait before closing — the lockout period is still active.",
  market_unavailable: "Market is temporarily unavailable.",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tradeId } = await params;
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { accountId: true, account: { select: { userId: true } } },
  });
  if (!trade || trade.account.userId !== session.userId) {
    return NextResponse.json({ error: "Trade not found." }, { status: 404 });
  }

  try {
    const result = await engineCfdClose(tradeId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json(
        { error: REJECTION_MESSAGE[err.reason] ?? "Could not close that trade." },
        { status: err.status },
      );
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "cfd.close_rejected", tradeId, reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}
