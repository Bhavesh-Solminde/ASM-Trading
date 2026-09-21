import { NextResponse, type NextRequest } from "next/server";
import { setDemoBalance, DemoBalanceRefused } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/**
 * Sets the caller's DEMO balance to `amountMinor` (minor units), or resets it to
 * the currency's full default when `amountMinor` is omitted. Ownership and the
 * cap are enforced in the repository.
 */
export async function POST(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { accountId?: unknown; amountMinor?: unknown }
    | null;
  if (!body || typeof body.accountId !== "string") {
    return NextResponse.json({ error: "Pick an account." }, { status: 400 });
  }

  let amount: number | undefined;
  if (body.amountMinor !== undefined && body.amountMinor !== null) {
    if (typeof body.amountMinor !== "number" || !Number.isInteger(body.amountMinor)) {
      return NextResponse.json({ error: "Enter a valid amount." }, { status: 400 });
    }
    amount = body.amountMinor;
  }

  try {
    const account = await setDemoBalance(
      amount === undefined
        ? { actorId: session.userId, accountId: body.accountId }
        : { actorId: session.userId, accountId: body.accountId, amount },
    );
    return NextResponse.json({ realBalance: account.realBalance, currency: account.currency });
  } catch (err) {
    if (err instanceof DemoBalanceRefused) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
