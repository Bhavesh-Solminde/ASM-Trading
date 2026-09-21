import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createDepositIntent } from "@asm/db";
import { randomUUID } from "node:crypto";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

/**
 * Admin-only "create a test deposit" tool — lets an operator watch a real
 * incoming SMS match a real deposit end to end, without the real checkout
 * page existing yet. Requires a userId to attach the deposit to; the
 * operator supplies one (e.g. their own seeded test user's id).
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("userId" in body) ||
    !("amountInrMinor" in body) ||
    typeof (body as { userId: unknown }).userId !== "string" ||
    typeof (body as { amountInrMinor: unknown }).amountInrMinor !== "number"
  ) {
    return NextResponse.json({ error: "userId and amountInrMinor are required." }, { status: 400 });
  }

  const { userId, amountInrMinor } = body as { userId: string; amountInrMinor: number };

  try {
    const deposit = await createDepositIntent({
      userId,
      method: "upi",
      amountInrMinor,
      correlationId: randomUUID(),
    });
    return NextResponse.json(
      { depositId: deposit.id, reservedAmountInr: deposit.amountInr, vpa: deposit.vpa },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
