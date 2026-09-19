import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { creditDepositToAccount } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

/** Manual override for an orphaned credit — links it to a specific deposit
 * and runs the exact same approve-and-credit transaction the auto-matcher
 * uses, just triggered by a human instead. */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("depositId" in body) ||
    !("creditId" in body) ||
    typeof (body as { depositId: unknown }).depositId !== "string" ||
    typeof (body as { creditId: unknown }).creditId !== "string"
  ) {
    return NextResponse.json({ error: "depositId and creditId are required." }, { status: 400 });
  }

  const { depositId, creditId } = body as { depositId: string; creditId: string };

  try {
    await creditDepositToAccount({ depositId, adminId: "admin-panel", creditId });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
