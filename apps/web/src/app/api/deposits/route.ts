import { NextResponse, type NextRequest } from "next/server";
import { CreateDepositSchema, type DepositView } from "@asm/contracts";
import { AmountSpaceExhausted, createDepositIntent, listDepositsForActor } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:deposit:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "deposits" }, "deposit throttled");
    return NextResponse.json(
      { error: "Too many deposit attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const parsed = CreateDepositSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "deposits" },
      "rejected deposit payload",
    );
    return NextResponse.json({ error: "Check the deposit details." }, { status: 400 });
  }

  try {
    const deposit = await createDepositIntent({
      userId: session.userId,
      method: parsed.data.method,
      amountInrMinor: parsed.data.amountInr,
      correlationId: ctx.cid,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    log.info(
      {
        evt: "deposit.intent",
        depositId: deposit.id,
        method: deposit.method,
        amountInr: deposit.amountInr,
      },
      "deposit intent created",
    );

    return NextResponse.json({ checkoutToken: deposit.checkoutToken }, { status: 201 });
  } catch (err) {
    if (err instanceof AmountSpaceExhausted) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof Error && /minimum|maximum/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const deposits = await listDepositsForActor(session.userId, 50);
  const view: DepositView[] = deposits.map((d) => ({
    id: d.id,
    method: d.method,
    amountUsd: d.amountUsd,
    amountInr: d.amountInr,
    status: d.status,
    claimedUtr: d.claimedUtr,
    createdAt: Math.floor(d.createdAt.getTime() / 1000),
  }));

  return NextResponse.json({ deposits: view }, { headers: { "Cache-Control": "no-store" } });
}
