import { NextResponse, type NextRequest } from "next/server";
import { UpdateProfileSchema } from "@asm/contracts";
import { KycLocked, loadProfile, updateProfile } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { getSession, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }
  return NextResponse.json({ profile: await loadProfile(session.userId) });
}

export async function PATCH(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
  }

  const parsed = UpdateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn({ evt: "security.validation_rejected", route: "account" }, "rejected profile payload");
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the details." },
      { status: 400 },
    );
  }

  try {
    await updateProfile(session.userId, parsed.data);
  } catch (err) {
    if (err instanceof KycLocked) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  log.info({ evt: "account.profile_updated", userId: session.userId }, "profile saved");

  return NextResponse.json({ profile: await loadProfile(session.userId) });
}
