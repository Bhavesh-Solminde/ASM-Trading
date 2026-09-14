import { NextResponse, type NextRequest } from "next/server";
import { UpdateProfileSchema } from "@asm/contracts";
import { loadProfile, updateProfile } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ profile: await loadProfile(session.userId) });
}

export async function PATCH(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = UpdateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "account" }, "rejected profile payload");
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the details." },
      { status: 400 },
    );
  }

  await updateProfile(session.userId, parsed.data);
  log.info({ evt: "account.profile_updated", userId: session.userId }, "profile saved");

  return NextResponse.json({ profile: await loadProfile(session.userId) });
}
