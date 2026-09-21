import { NextResponse, type NextRequest } from "next/server";
import { changeAccountCurrency, CurrencyChangeRefused } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

const CURRENCIES = new Set(["INR", "USD"]);

export async function POST(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
    const account = await changeAccountCurrency({
      actorId: session.userId,
      accountId: body.accountId,
      currency: body.currency,
    });
    return NextResponse.json({ currency: account.currency });
  } catch (err) {
    if (err instanceof CurrencyChangeRefused) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
