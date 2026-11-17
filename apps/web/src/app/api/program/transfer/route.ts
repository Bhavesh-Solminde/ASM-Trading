import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { listAccountsForActor, transferProgramEarningsToTrading } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { getSession, rateLimited, unauthenticated } from "@/lib/request-session";
import { refusedResponse } from "../refused";

const TransferSchema = z.strictObject({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.uuid(),
});

/** Moves available program earnings (INR paise) into the caller's own LIVE trading balance. */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) return unauthenticated();

  if ((await checkNetwork({ ip: ctx.ip, route: "program_transfer", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
  if (!(await checkRateLimit(`rl:program-transfer:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "program_transfer" }, "program transfer throttled");
    return rateLimited("Too many transfer attempts. Wait a few minutes.");
  }

  const parsed = TransferSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });

  try {
    const result = await transferProgramEarningsToTrading({ userId: session.userId, ...parsed.data });
    // The engine does not see this credit; return the fresh LIVE balance so the TopBar updates now.
    const live = (await listAccountsForActor(session.userId)).find((a) => a.type === "LIVE");
    return NextResponse.json(
      {
        ...result,
        accountId: live?.id ?? null,
        balance: live ? { realBalance: live.realBalance, bonusBalance: live.bonusBalance } : null,
      },
      { status: 201 },
    );
  } catch (err) {
    return refusedResponse(err);
  }
}
