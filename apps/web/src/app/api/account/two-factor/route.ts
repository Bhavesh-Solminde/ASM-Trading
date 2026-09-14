import { NextResponse, type NextRequest } from "next/server";
import { TwoFaToggleSchema } from "@asm/contracts";
import { issueTwoFactorCode, setTwoFactorPreferences } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/** PATCH updates preferences. POST issues a code for the given purpose. */
export async function PATCH(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = TwoFaToggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the settings." }, { status: 400 });
  }

  await setTwoFactorPreferences(session.userId, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const purpose = req.nextUrl.searchParams.get("purpose") ?? "login";
  if (purpose !== "login" && purpose !== "withdrawal") {
    return NextResponse.json({ error: "Unknown purpose." }, { status: 400 });
  }

  // The code is logged, never returned. Read it from the server terminal.
  await issueTwoFactorCode(session.userId, purpose);

  return NextResponse.json({ sent: true, hint: "This build writes the code to the server log." });
}
