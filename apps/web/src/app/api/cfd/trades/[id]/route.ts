import { NextResponse, type NextRequest } from "next/server";
import { CfdModifyTradeSchema } from "@asm/contracts";
import { prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { EngineRejected, EngineUnavailable, engineCfdModify } from "@/lib/engine-client";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await req.json().catch(() => null);
  const parsed = CfdModifyTradeSchema.safeParse({ tradeId, ...(body as object) });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid modification." }, { status: 400 });
  }

  try {
    const changes: { stopLoss?: number | null; takeProfit?: number | null } = {};
    if (parsed.data.stopLoss !== undefined) changes.stopLoss = parsed.data.stopLoss;
    if (parsed.data.takeProfit !== undefined) changes.takeProfit = parsed.data.takeProfit;
    await engineCfdModify(tradeId, changes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EngineRejected) {
      return NextResponse.json({ error: err.reason }, { status: err.status });
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "cfd.modify_rejected", tradeId, reason: "engine_unavailable" }, err.message);
      return NextResponse.json({ error: "Trading is temporarily unavailable." }, { status: 503 });
    }
    throw err;
  }
}
