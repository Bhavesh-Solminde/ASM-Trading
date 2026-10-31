import { NextResponse, type NextRequest } from "next/server";
import { convertAccountCurrency, CurrencyChangeRefused } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE, readSession } from "@/lib/session";

const CURRENCIES = new Set(["INR", "USD"]);

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // A currency switch rewrites the balance and every trade row in one
  // transaction under a row lock — a human does it a handful of times, never in
  // bursts. Bounds a script hammering the lock.
  if (!(await checkRateLimit(`rl:currency:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "account_currency" }, "currency switch throttled");
    return NextResponse.json(
      { error: "Too many currency changes. Wait a few minutes." },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { accountId?: unknown; currency?: unknown } | null;
  if (
    !body ||
    typeof body.accountId !== "string" ||
    typeof body.currency !== "string" ||
    !CURRENCIES.has(body.currency.toUpperCase())
  ) {
    return NextResponse.json({ error: "Pick a supported currency." }, { status: 400 });
  }

  try {
    const account = await convertAccountCurrency({
      actorId: session.userId,
      accountId: body.accountId,
      currency: body.currency,
    });
    return NextResponse.json({ currency: account.currency });
  } catch (err) {
    if (err instanceof CurrencyChangeRefused) {
      return NextResponse.json(
        err.code ? { error: err.message, code: err.code } : { error: err.message },
        { status: 409 },
      );
    }
    throw err;
  }
}
