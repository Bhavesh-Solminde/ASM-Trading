import { NextResponse, type NextRequest } from "next/server";
import { OtcSetStopsSchema, OtcTradeIdSchema, tradeRejectionMessage } from "@asm/contracts";
import { childLogger } from "@asm/logger";
import { EngineRejected, EngineUnavailable } from "@/lib/engine-client";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { engineOtcSetStops } from "@/lib/otc-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { getSession, noStoreJson, rateLimited, unauthenticated } from "@/lib/request-session";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);
  if ((await checkNetwork({ ip: ctx.ip, route: "trade_stops", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
  if (!await checkRateLimit(`rl:trade-stops:${session.userId}`, 60, 60)) {
    log.warn({ evt: "security.rate_limited", route: "trade_stops" }, "stop changes throttled");
    return rateLimited("Slow down a moment and try again.");
  }

  const { id } = await params;
  if (!OtcTradeIdSchema.safeParse(id).success) {
    return noStoreJson({ code: "not_found", error: tradeRejectionMessage("not_found") }, { status: 404 });
  }
  const parsed = OtcSetStopsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "trade_stops" }, "rejected stops payload");
    return NextResponse.json({ error: "Check the stop loss and take profit levels." }, { status: 400 });
  }
  try {
    return noStoreJson(await engineOtcSetStops(id, { ...parsed.data, actorId: session.userId }));
  } catch (err) {
    if (err instanceof EngineRejected) {
      return noStoreJson({ code: err.reason, error: tradeRejectionMessage(err.reason) }, { status: 409 });
    }
    if (err instanceof EngineUnavailable) {
      log.error({ evt: "trade.stops_unavailable" }, err.message);
      return noStoreJson({ code: "trading_unavailable", error: tradeRejectionMessage("trading_unavailable") }, { status: 503 });
    }
    throw err;
  }
}
