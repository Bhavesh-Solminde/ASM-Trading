import { NextResponse, type NextRequest } from "next/server";
import { CfdModifyTradeSchema, cfdTradeViewFrom } from "@asm/contracts";
import { prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { getSession, unauthenticated } from "@/lib/request-session";
import { requestContext } from "@/lib/request-context";
import { EngineRejected, EngineUnavailable, engineCfdModify } from "@/lib/engine-client";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tradeId } = await params;
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { accountId: true, durationSec: true, account: { select: { userId: true } } },
  });
  if (!trade || trade.durationSec === null || trade.account.userId !== session.userId) {
    return NextResponse.json({ error: "Trade not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = CfdModifyTradeSchema.safeParse({ ...(body as object), tradeId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid modification." }, { status: 400 });
  }

  try {
    const changes: { stopLoss?: number | null; takeProfit?: number | null } = {};
    if (parsed.data.stopLoss !== undefined) changes.stopLoss = parsed.data.stopLoss;
    if (parsed.data.takeProfit !== undefined) changes.takeProfit = parsed.data.takeProfit;
    await engineCfdModify(tradeId, changes);
    const updated = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { asset: true } });
    return NextResponse.json({ trade: cfdTradeViewFrom(updated, updated.asset.symbol) });
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json({ error: err.reason, code: err.reason }, { status: err.status });
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "cfd.modify_rejected", tradeId, reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}
