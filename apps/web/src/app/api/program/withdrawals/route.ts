import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PayoutDetailsSchema, payoutDestinationLabel } from "@asm/contracts";
import { listProgramWithdrawals, requestProgramWithdrawal } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { getSession, noStoreJson, rateLimited, unauthenticated } from "@/lib/request-session";
import { refusedResponse } from "../refused";

const ProgramWithdrawalSchema = z.strictObject({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  payout: PayoutDetailsSchema,
  idempotencyKey: z.uuid(),
});

/** Requests a payout of available program earnings (INR paise) to a bank account, UPI ID or USDT wallet. */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) return unauthenticated();

  if ((await checkNetwork({ ip: ctx.ip, route: "program_withdrawals", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }
  if (!(await checkRateLimit(`rl:program-withdraw:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "program_withdrawals" }, "program withdrawal throttled");
    return rateLimited("Too many withdrawal attempts. Wait a few minutes.");
  }

  const parsed = ProgramWithdrawalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Same rule as /api/withdrawals: name the field to fix when the schema has a human message.
    const first = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: first && !first.startsWith("Invalid") ? first : "Check the withdrawal details." },
      { status: 400 },
    );
  }

  try {
    const withdrawal = await requestProgramWithdrawal({
      userId: session.userId,
      ...parsed.data,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return NextResponse.json({ id: withdrawal.id, status: withdrawal.status, amountMinor: withdrawal.amountMinor }, { status: 201 });
  } catch (err) {
    return refusedResponse(err);
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  if (!(await checkRateLimit(`rl:program-read:${session.userId}`, 120, 60))) return rateLimited();
  // Public fields only: no IP / user agent / reviewer / idempotency key.
  const rows = await listProgramWithdrawals(session.userId);
  return noStoreJson({
    withdrawals: rows.map((w) => ({
      id: w.id,
      createdAt: w.createdAt,
      amountMinor: w.amountMinor,
      currency: w.currency,
      method: w.method,
      destination: payoutDestinationLabel(w),
      status: w.status,
      reason: w.reason,
      paidAt: w.paidAt,
    })),
  });
}
